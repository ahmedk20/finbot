// What a resolved API key looks like after validation
// Attached to req.user by auth middleware so every controller knows who's calling
export interface AuthUser {
  userId:    string;
  email:     string;
  plan:      'FREE' | 'STARTER' | 'PRO' | 'BUSINESS';
  apiKeyId:  string;
}

export interface CreateUserInput {
  email:    string;
  password: string;
}

export interface CreateApiKeyInput {
  userId: string;
  name?:  string;
}

// What we return when a key is first created
// After this response the full key is gone forever — we only stored the hash
export interface CreatedApiKey {
  id:        string;
  fullKey:   string; // shown ONCE
  prefix:    string; // shown in dashboard forever
  name:      string | null;
  createdAt: Date;
}
