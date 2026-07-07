// Per-provider credential form schema. Single-field providers map to `secret`;
// multi-field providers (kiro) map to `creds`.
export interface Field {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  secret?: boolean;
}

export interface ProviderForm {
  // when single, the one field's value is sent as `secret`
  single: boolean;
  fields: Field[];
}

const apiKeyForm: ProviderForm = {
  single: true,
  fields: [{ key: "api_key", label: "API Key", placeholder: "sk-...", required: true, secret: true }],
};

const kiroForm: ProviderForm = {
  single: false,
  fields: [
    { key: "access_token", label: "Access Token", required: true, secret: true },
    { key: "refresh_token", label: "Refresh Token", required: true, secret: true },
    { key: "profile_arn", label: "Profile ARN", placeholder: "arn:aws:codewhisperer:..." },
    { key: "sso_region", label: "SSO Region", placeholder: "us-east-1" },
    { key: "auth_method", label: "Auth Method", placeholder: "social | builder-id | idc" },
    { key: "client_id", label: "Client ID" },
    { key: "client_secret", label: "Client Secret", secret: true },
  ],
};

// Suno stores its key as an api_key credential (not the generic `secret`), so the
// music handlers can read creds["api_key"].
const sunoForm: ProviderForm = {
  single: false,
  fields: [{ key: "api_key", label: "Suno API Key", placeholder: "Get one at sunoapi.org", required: true, secret: true }],
};

// Leonardo authenticates with a JWT access_token, stored as a credential (the
// cognito sub + email are derived from the token server-side).
const leonardoForm: ProviderForm = {
  single: false,
  fields: [{ key: "access_token", label: "Access Token (JWT)", placeholder: "eyJ… (from app.leonardo.ai)", required: true, secret: true }],
};

// Claude Code authenticates with a subscription OAuth token (access + refresh),
// NOT an API key. Easiest is "Import from local" (reads your existing login);
// these fields are the manual fallback.
const claudeCodeForm: ProviderForm = {
  single: false,
  fields: [
    { key: "access_token", label: "Access Token", placeholder: "sk-ant-oat01-…", required: true, secret: true },
    { key: "refresh_token", label: "Refresh Token", placeholder: "sk-ant-ort01-…", required: true, secret: true },
    { key: "expires_at", label: "Expires At (unix ms)", placeholder: "optional" },
    { key: "subscription_type", label: "Subscription", placeholder: "max | pro (optional)" },
  ],
};

export function formFor(provider: string): ProviderForm {
  switch (provider) {
    case "kiro":
      return kiroForm;
    case "suno":
      return sunoForm;
    case "leonardo":
      return leonardoForm;
    case "claudecode":
      return claudeCodeForm;
    default:
      return apiKeyForm;
  }
}
