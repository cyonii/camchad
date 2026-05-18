import type { MovementDefinition } from './movement-definition-types.js';

export type MovementReadinessStage =
  | 'recognition_ready'
  | 'count_ready'
  | 'validation_ready'
  | 'quality_ready';

export interface MovementReadinessItem {
  readonly stage: MovementReadinessStage;
  readonly label: string;
  readonly passed: boolean;
  readonly detail: string;
}

export function movementReadinessChecklist(
  definition: MovementDefinition,
): readonly MovementReadinessItem[] {
  const hasExecutableRecognition = definition.profile.recognitionCriteria.some(
    (criterion) => criterion.source !== 'planned',
  );
  const hasExecutableValidation = definition.profile.validationCriteria.some(
    (criterion) => criterion.source !== 'planned',
  );
  const hasMetricTelemetry = definition.profile.telemetryExtractors.some(
    (extractor) => extractor.source === 'metric',
  );

  return [
    {
      stage: 'recognition_ready',
      label: 'Recognition profile',
      passed:
        movementMaturityRank(definition.maturity) >= movementMaturityRank('recognized') &&
        hasExecutableRecognition,
      detail: hasExecutableRecognition
        ? 'Executable recognition criteria are defined.'
        : 'Recognition criteria are still planned.',
    },
    {
      stage: 'count_ready',
      label: 'Count primitive',
      passed: movementMaturityRank(definition.maturity) >= movementMaturityRank('rep_counting'),
      detail:
        movementMaturityRank(definition.maturity) >= movementMaturityRank('rep_counting')
          ? `Uses the ${formatFamilyPrimitive(definition.profile.family)} primitive.`
          : 'No counting primitive is active yet.',
    },
    {
      stage: 'validation_ready',
      label: 'Validation criteria',
      passed:
        movementMaturityRank(definition.maturity) >= movementMaturityRank('rep_validating') &&
        hasExecutableValidation,
      detail: hasExecutableValidation
        ? 'Rep validation criteria are executable.'
        : 'Rep validation criteria are not implemented yet.',
    },
    {
      stage: 'quality_ready',
      label: 'Quality telemetry',
      passed:
        definition.maturity === 'quality_validating' &&
        hasExecutableValidation &&
        hasMetricTelemetry,
      detail: hasMetricTelemetry
        ? 'Metric telemetry is available for quality analysis.'
        : 'Quality telemetry is not decomposed into metric extractors yet.',
    },
  ];
}

export function movementMaturityRank(maturity: MovementDefinition['maturity']): number {
  const ranks: Record<MovementDefinition['maturity'], number> = {
    planned: 0,
    detected: 1,
    recognized: 2,
    rep_counting: 3,
    rep_validating: 4,
    quality_validating: 5,
  };

  return ranks[maturity];
}

function formatFamilyPrimitive(family: MovementDefinition['profile']['family']): string {
  return family.replaceAll('_', ' ');
}
