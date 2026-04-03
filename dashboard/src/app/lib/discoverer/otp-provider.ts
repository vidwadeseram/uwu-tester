export interface OtpProvider {
  getOtp(params: { provider: string; app: string; environment: string; promptContext?: string }): Promise<string>;
}

export interface OtpProviderConfig {
  type: "env" | "tmux" | "mcp" | "custom";
  envVar?: string;
  tmuxSession?: string;
  tmuxWindow?: string;
  customCommand?: string;
}

export function createOtpProvider(config?: OtpProviderConfig): OtpProvider {
  const type = config?.type ?? "env";
  if (type === "env") {
    const envVar = config?.envVar ?? "UWU_SPEC_OTP";
    return {
      getOtp: async () => {
        // In a real environment this would query a secure store or prompt user.
        return (process.env[envVar] ?? "");
      },
    };
  }
  // Stub implementations for non-env providers
  if (type === "tmux" || type === "mcp" || type === "custom") {
    return {
      getOtp: async () => {
        throw new Error("not implemented in TypeScript — use MCP server");
      },
    };
  }
  // Fallback
  return {
    getOtp: async () => "",
  };
}
