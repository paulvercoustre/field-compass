import { SamplingMode } from '../types';

const KNOWN_MODES: SamplingMode[] = ['none', 'total', 'by_variable', 'uploaded'];

/**
 * How a survey expresses its collection targets.
 *
 * Mirrors `get_sampling_mode()` in backend/services/survey_config.py, and must
 * keep mirroring it: a config stored before `mode` existed carries none, and is
 * **inferred** from whether it has frame rows rather than defaulted to a
 * constant. Defaulting would tell an existing survey it has no targets when it
 * has a full frame, and the settings screen would then offer to "add" targets
 * it already has.
 *
 * An unrecognised value infers too, for the same reason the backend does it: a
 * typo must not silently drop targets a survey actually has.
 */
export const inferSamplingMode = (
  samplingFrame:
    | {
        mode?: string | null;
        frame_data?: Record<string, any>[] | null;
      }
    | null
    | undefined
): SamplingMode => {
  const declared = samplingFrame?.mode;
  if (declared && (KNOWN_MODES as string[]).includes(declared)) {
    return declared as SamplingMode;
  }
  return samplingFrame?.frame_data?.length ? 'uploaded' : 'none';
};
