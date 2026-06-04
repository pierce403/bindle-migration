const userAgent = process.env.npm_config_user_agent ?? "";

if (!userAgent.startsWith("pnpm/")) {
  console.error("Bindle Migration uses pnpm. Run commands with pnpm, not npm.");
  process.exit(1);
}
