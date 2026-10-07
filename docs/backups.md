# Database backups

The production stack has a `backup` service (`deploy/backup/`). Once a day, from 02:00 UTC, it dumps the database and stores the copy in two places:

| Where | What | How long |
|---|---|---|
| On the VM, in the `db_backups` volume | The latest 3 dumps | Until replaced. Quick to restore from, but lost with the VM's disk. |
| Azure Blob Storage, `daily/` | Every day's dump | 14 days |
| Azure Blob Storage, `weekly/` | Sunday's dump | 90 days |

The service starts with the normal deploy. Uploads begin once `BACKUP_UPLOAD_URL` is set in the VM's `.env`; until then the service logs a warning on every run and keeps copies on the VM only.

**How the backups are protected**
- **Unique names:** each file is named after the time it was taken, for example `daily/field_compass-2026-10-08T02-00-14Z.dump`, so no backup replaces another.
- **Add-only key:** the VM's key can create new files and nothing else. It cannot overwrite, delete or read a backup, so a mistake on the VM, or someone who breaks into it, cannot destroy existing copies.
- **Expiry and soft delete:** old copies are removed by expiry rules on the storage account, never by the VM. Soft delete keeps anything deleted recoverable for a further 7 days.

**Keep `.env` safe as well.** Stored Kobo tokens and AI keys are encrypted with `ENCRYPTION_KEY`, and a restored database is only usable with the same key. Keep a copy of the VM's `.env` in a password manager.

## One-time setup

Run these in [Azure Cloud Shell](https://shell.azure.com), using the Bash option, or anywhere `az` is logged in to the subscription the VM runs in.

```bash
RG=<the VM's resource group>
LOC=<the VM's region, e.g. westeurope>
ACCT=fcbackups$RANDOM          # 3-24 lowercase letters/digits, unique across Azure; note it down

# 1. A storage account. Standard_GRS keeps a second copy in another region;
#    Standard_LRS is cheaper and still separate from the VM.
az storage account create -n "$ACCT" -g "$RG" -l "$LOC" \
  --sku Standard_GRS --kind StorageV2 \
  --min-tls-version TLS1_2 --allow-blob-public-access false

# 2. Deleted files stay recoverable for 7 days.
az storage account blob-service-properties update -n "$ACCT" -g "$RG" \
  --enable-delete-retention true --delete-retention-days 7

# 3. The private container.
az storage container create --account-name "$ACCT" -n db-backups --auth-mode key

# 4. Expiry: daily copies after 14 days, weekly copies after 90.
cat > backup-policy.json <<'EOF'
{"rules": [
  {"name": "expire-daily", "enabled": true, "type": "Lifecycle", "definition": {
    "filters": {"blobTypes": ["blockBlob"], "prefixMatch": ["db-backups/daily/"]},
    "actions": {"baseBlob": {"delete": {"daysAfterModificationGreaterThan": 14}}}}},
  {"name": "expire-weekly", "enabled": true, "type": "Lifecycle", "definition": {
    "filters": {"blobTypes": ["blockBlob"], "prefixMatch": ["db-backups/weekly/"]},
    "actions": {"baseBlob": {"delete": {"daysAfterModificationGreaterThan": 90}}}}}
]}
EOF
az storage account management-policy create --account-name "$ACCT" -g "$RG" --policy @backup-policy.json

# 5. The VM's add-only key ("c" = create), valid for a year. It is tied to a
#    named policy so it can be revoked: delete the policy and the key stops
#    working. Pick an expiry about a year out.
az storage container policy create --account-name "$ACCT" -c db-backups \
  -n vm-upload --permissions c --expiry 2027-10-31T00:00Z --auth-mode key
SAS=$(az storage container generate-sas --account-name "$ACCT" -n db-backups \
  --policy-name vm-upload --auth-mode key -o tsv)
echo "BACKUP_UPLOAD_URL=https://$ACCT.blob.core.windows.net/db-backups?$SAS"
```

Then, on the VM:

1. Add the printed `BACKUP_UPLOAD_URL=...` line to `~/field-compass/.env`.
2. Recreate the service so it picks up the URL, and take a first backup straight away:

   ```bash
   cd ~/field-compass
   docker compose -f docker-compose.prod.yml up -d backup
   docker compose -f docker-compose.prod.yml exec backup backup.sh
   ```

   The last lines should read `uploaded to daily/...` and `done`. In the portal, under the storage account → **Containers** → `db-backups` → `daily`, the file is listed.

3. **Do one practice restore** (below), into a scratch database. A backup that has never been restored is an assumption.

**When the key expires**, uploads fail and the service turns unhealthy. Renew the key a little before that date: run step 5 again with a new expiry, using `az storage container policy update` instead of `create`, then update `.env` and recreate the service.

## Checking on it

```bash
cd ~/field-compass
docker compose -f docker-compose.prod.yml ps backup         # "healthy" = a good backup in the last 26 h
docker compose -f docker-compose.prod.yml logs --tail 20 backup
docker compose -f docker-compose.prod.yml exec backup ls -l /backups   # the copies on the VM
```

A failed run logs a line containing `BACKUP FAILED` and is retried an hour later. If there's no good backup for 26 hours, `ps` shows the service as `unhealthy`.

Settings, all optional, in `.env`:
- `BACKUP_HOUR`: the hour (UTC) after which the daily backup runs. Default 2.
- `BACKUP_KEEP_LOCAL`: how many copies stay on the VM. Default 3.

## Restoring

**1. Get the file.**
- **From Azure:** portal → storage account → **Containers** → `db-backups` → the file → **Download**, then copy it to the VM with `scp backup.dump azureuser@<vm>:~/`.
- **Or from the VM's own copies:**

  ```bash
  docker compose -f docker-compose.prod.yml cp backup:/backups/<file>.dump ~/backup.dump
  ```

**2. Check it first, in a scratch database.** This leaves the live database untouched:

```bash
cd ~/field-compass
C="docker compose -f docker-compose.prod.yml"
$C exec -T postgres createdb -U postgres restore_check
$C exec -T postgres pg_restore --no-owner -U postgres -d restore_check < ~/backup.dump
$C exec -T postgres psql -U postgres -d restore_check -c "select count(*) from survey_configs"
$C exec -T postgres dropdb -U postgres restore_check
```

**3. To replace the live database,** stop what writes to it, restore in one transaction (all or nothing), then start it again:

```bash
$C stop backend worker
$C exec -T postgres pg_restore --clean --if-exists --single-transaction --no-owner \
  -U postgres -d field_compass < ~/backup.dump
$C start backend worker
```

**Version rule:** restore with the same or a newer `pg_restore` than the one that made the dump. Running it inside the `postgres` container, as above, ensures that.
