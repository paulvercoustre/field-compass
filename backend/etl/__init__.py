"""
ETL package for data ingestion and processing.

Import from the submodules directly (`from etl.pipeline import ETLPipeline`).
Nothing is re-exported here: doing so loaded the whole pipeline -- and through
it the AI service -- whenever any `etl.*` module was imported, so a service
that needed only `etl.dk_utils` closed an import cycle back onto itself.
"""
