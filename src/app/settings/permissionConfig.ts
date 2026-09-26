export const FEATURE_KEYS = ["dashboard", "work_log_approvals", "payroll", "rooms", "historical_import", "user_management", "settings"] as const;

export type FeatureKey = typeof FEATURE_KEYS[number];

export type FeaturePermission = {
  user_id: string;
  feature_key: FeatureKey;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
};
