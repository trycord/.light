// .light — Cloudflare API token setup guide (run: node scripts/cloudflare-token-guide.js)
console.log(`
.light — Cloudflare API Token Setup
===================================

Your current token can READ zones but cannot WRITE DNS or create tunnels.
Create a new token with these permissions:

  STEP 1  https://dash.cloudflare.com/profile/api-tokens
  STEP 2  Create Token → Custom token → Configure:
            Account → Cloudflare Tunnel : Edit
            Zone    → DNS : Edit
            Zone    → Zone : Read
            Zone Resources: Include → Specific zone → trycord.dev
  STEP 3  Copy the token and paste it into Admin → Settings → Cloudflare → API Token.

Required settings in Admin → Settings → Cloudflare:
  API Token  = <new token>
  Account ID = 78fc1c328e868c61fa5d0a4f615f01f2
  Zone ID    = 4bef56b51a7033361b75d2a28bbe70fd
  Domain     = trycord.dev

After saving, Admin → Platform status will show "Ready" and per-application
tunnels will be provisioned automatically for website services.
`);
