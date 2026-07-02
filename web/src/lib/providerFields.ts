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

export function formFor(provider: string): ProviderForm {
  switch (provider) {
    case "kiro":
      return kiroForm;
    case "suno":
      return sunoForm;
    default:
      return apiKeyForm;
  }
}
