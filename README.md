# Discord Digital Store Bot v2

Features:
- Product panel, stock view, private purchase tickets
- Product selection and persistent order records
- Payment instructions configurable for eSewa, Khalti and Fonepay
- Customer submits transaction reference; staff manually verifies it
- Staff `/mark-paid` then `/deliver` workflow
- Order logs (optional LOG_CHANNEL_ID)
- `/set-stock`, `/set-price`, `/add-product`
- `/order-status`, `/review`, `/warranty`, `/payment-info`, `/close-ticket`
- Persistent JSON order/review storage

## Security
A Discord bot token was shared in chat earlier. Reset it in Discord Developer Portal and use ONLY the new token in your private `.env`. Never send it in chat or commit `.env` to GitHub.

## Setup
1. Create/refresh bot token at https://discord.com/developers/applications.
2. Invite bot with scopes `bot` and `applications.commands`. Permissions: Manage Channels, View Channels, Send Messages, Embed Links, Read Message History.
3. Copy `.env.example` to `.env` and fill token. CLIENT_ID and GUILD_ID are prefilled from your setup. Set optional role/category/log channel IDs.
4. Configure eSewa/Khalti/Fonepay payment receiver details in `.env` (these are display instructions only).
5. Run `npm install`, then `npm start`. Slash commands register automatically on startup.
6. In Discord run `/setup-panel`.

## Commands
- `/setup-panel` — post catalogue
- `/payment-info` — show payment receiver details
- `/mark-paid` — staff manually verifies payment and marks paid
- `/deliver details:` — staff sends product/code after payment is marked paid
- `/set-stock product: stock:` — update stock label
- `/set-price product: price:` — update price
- `/add-product name: price: stock:` — add product
- `/order-status` — view current ticket order
- `/review rating: comment:` — customer review after delivery
- `/warranty details:` — warranty/support request
- `/close-ticket` — close current ticket

## Important payment limitation
This build does NOT connect to eSewa/Khalti/Fonepay merchant APIs and does NOT automatically verify payments. It only displays payment instructions and collects transaction references. Staff must verify transactions in the official merchant dashboard/app before `/mark-paid`. Actual API auto-verification requires approved merchant API credentials and a provider-specific integration.
