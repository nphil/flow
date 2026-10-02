import type { ReadabilityRule } from '../types';
import { deviceIdRule } from './device-id';
import { longTemplateRule } from './long-template';
import { missingAliasRule } from './missing-alias';
import { missingDescriptionRule } from './missing-description';
import { templateNativeRule } from './template-native';
import { unavailableRestoreRule } from './unavailable-restore';

/**
 * Every readability rule, in the order ties are listed. To add a rule: write a module in this
 * folder that exports a `ReadabilityRule`, and list it here. Nothing else needs to change.
 */
export const READABILITY_RULES: readonly ReadabilityRule[] = [
  unavailableRestoreRule,
  deviceIdRule,
  templateNativeRule,
  longTemplateRule,
  missingAliasRule,
  missingDescriptionRule,
];
