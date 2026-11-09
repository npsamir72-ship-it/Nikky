import 'dotenv/config';
import fs from 'node:fs';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Client, EmbedBuilder,
  Events, GatewayIntentBits, ModalBuilder, PermissionFlagsBits, REST, Routes,
  SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle
} from 'discord.js';

const {
  DISCORD_TOKEN, CLIENT_ID, GUILD_ID, SUPPORT_ROLE_ID = '', TICKET_CATEGORY_ID = '',
  LOG_CHANNEL_ID = '', STORE_NAME = 'FrOX Store', CURRENCY = 'NPR',
  STORE_LOGO_URL = '', STORE_BANNER_URL = '', ESEWA_ID = '', KHALTI_ID = '',
  FONEPAY_INFO = '', PAYMENT_NOTE = 'Pay only after staff confirms your order.',
  WARRANTY_TEXT = 'Your product comes with the warranty stated by staff. Refunds or replacements are handled only for valid product issues.'
} = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error('Missing required environment variables: DISCORD_TOKEN, CLIENT_ID and GUILD_ID');
}

const DATA_DIR = new URL('./data/', import.meta.url);
const PRODUCTS_FILE = new URL('./products.json', import.meta.url);
const ORDERS_FILE = new URL('./data/orders.json', import.meta.url);
const REVIEWS_FILE = new URL('./data/reviews.json', import.meta.url);
fs.mkdirSync(DATA_DIR, { recursive: true });
const readJson = (url, fallback) => { try { return JSON.parse(fs.readFileSync(url, 'utf8')); } catch { return fallback; } };
const writeJson = (url, value) => fs.writeFileSync(url, JSON.stringify(value, null, 2));
let products = readJson(PRODUCTS_FILE, []).map(p => ({ emoji: '📦', image: '', ...p }));
let orders = readJson(ORDERS_FILE, []);
let reviews = readJson(REVIEWS_FILE, []);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder().setName('setup-panel').setDescription('Post the Product Details store panel').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('add-product').setDescription('Add a product to the store')
    .addStringOption(o => o.setName('name').setDescription('Product name').setRequired(true))
    .addStringOption(o => o.setName('price').setDescription('Example: 199').setRequired(true))
    .addStringOption(o => o.setName('stock').setDescription('Example: Available / N/A / Ticket').setRequired(true))
    .addStringOption(o => o.setName('emoji').setDescription('Product logo emoji').setRequired(false))
    .addStringOption(o => o.setName('image').setDescription('Direct image URL (optional)').setRequired(false)),
  new SlashCommandBuilder().setName('edit-product').setDescription('Edit a product')
    .addStringOption(o => o.setName('name').setDescription('Existing product name').setRequired(true))
    .addStringOption(o => o.setName('price').setDescription('New price').setRequired(false))
    .addStringOption(o => o.setName('stock').setDescription('New stock label').setRequired(false))
    .addStringOption(o => o.setName('emoji').setDescription('New emoji/logo').setRequired(false))
    .addStringOption(o => o.setName('image').setDescription('New direct image URL').setRequired(false)),
  new SlashCommandBuilder().setName('delete-product').setDescription('Delete a product')
    .addStringOption(o => o.setName('name').setDescription('Exact product name').setRequired(true)),
  new SlashCommandBuilder().setName('close-ticket').setDescription('Close this purchase ticket'),
  new SlashCommandBuilder().setName('payment-info').setDescription('Show configured payment methods in this ticket'),
  new SlashCommandBuilder().setName('mark-paid').setDescription('Staff: mark this ticket order as paid'),
  new SlashCommandBuilder().setName('deliver').setDescription('Staff: deliver the product').addStringOption(o => o.setName('details').setDescription('Delivery details').setRequired(true)),
  new SlashCommandBuilder().setName('order-status').setDescription('Staff: show current ticket order status'),
  new SlashCommandBuilder().setName('review').setDescription('Leave a store review after purchase')
    .addIntegerOption(o => o.setName('rating').setDescription('Rating from 1 to 5').setMinValue(1).setMaxValue(5).setRequired(true))
    .addStringOption(o => o.setName('comment').setDescription('Your feedback').setRequired(false)),
  new SlashCommandBuilder().setName('warranty').setDescription('Open a warranty/support request')
    .addStringOption(o => o.setName('details').setDescription('Explain the issue; do not include passwords or OTPs').setRequired(true))
].map(c => c.toJSON());

function saveProducts() { writeJson(PRODUCTS_FILE, products); }
function saveOrders() { writeJson(ORDERS_FILE, orders); }
function isStaff(i) {
  return Boolean(i.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
    (SUPPORT_ROLE_ID && i.member?.roles?.cache?.has(SUPPORT_ROLE_ID)));
}
function isHttpUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' || u.protocol === 'http:'; }
  catch { return false; }
}
function priceText(p) {
  const raw = String(p.price ?? 'N/A');
  return /[a-z€$₹]/i.test(raw) ? raw : `${raw} ${CURRENCY}`;
}
function productLine(p) {
  return `${p.emoji || '📦'} **${p.name}**  ·  \`${priceText(p)}\``;
}
function productEmbed() {
  const list = products.length ? products.map(productLine).join('\n') : 'No products added yet. Staff can use `/add-product`.';
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`🛒 Product Details`)
    .setDescription(`Browse our premium digital products below. Accounts and services are checked before delivery.\n\n━━━━━━━━━━━━━━━━━━━━\n${list}\n━━━━━━━━━━━━━━━━━━━━\n\nℹ️ **Warranty:** ${WARRANTY_TEXT}`)
    .setFooter({ text: `${STORE_NAME} • Buy securely through a private ticket` })
    .setTimestamp();
  if (STORE_LOGO_URL && isHttpUrl(STORE_LOGO_URL)) embed.setThumbnail(STORE_LOGO_URL);
  if (STORE_BANNER_URL && isHttpUrl(STORE_BANNER_URL)) embed.setImage(STORE_BANNER_URL);
  return embed;
}
function panelRows() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('view_stock').setLabel('View Stock').setEmoji('❔').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('buy_now').setLabel('Buy Now').setEmoji('🛒').setStyle(ButtonStyle.Primary)
  )];
}
function productMenu() {
  const options = products.slice(0, 25).map((p, i) => ({
    label: p.name.slice(0, 100), description: `${priceText(p)} • ${p.stock || 'Ask staff'}`.slice(0, 100),
    value: String(i), ...(p.emoji ? { emoji: p.emoji } : {})
  }));
  return options.length ? [new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('choose_product').setPlaceholder('Select the product you want to buy').addOptions(options)
  )] : [];
}
function ticketControls() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('payment_info').setLabel('Payment Info').setEmoji('💳').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('paid_submit').setLabel('I Have Paid').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger)
  )];
}
async function log(guild, message, embed) {
  if (!LOG_CHANNEL_ID) return;
  const ch = await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
  if (ch?.isTextBased()) await ch.send({ content: message || undefined, embeds: embed ? [embed] : [] }).catch(() => {});
}
async function createTicket(i) {
  const guild = i.guild;
  const existing = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.topic?.includes(`ticket-owner:${i.user.id}`));
  if (existing) return i.reply({ content: `You already have an open ticket: ${existing}`, ephemeral: true });
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
  ];
  if (SUPPORT_ROLE_ID) overwrites.push({ id: SUPPORT_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  const clean = i.user.username.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 25) || 'customer';
  const channel = await guild.channels.create({
    name: `ticket-${clean}-${i.user.id.slice(-4)}`, type: ChannelType.GuildText,
    topic: `Purchase ticket | ticket-owner:${i.user.id}`, parent: TICKET_CATEGORY_ID || undefined,
    permissionOverwrites: overwrites
  });
  const intro = new EmbedBuilder().setColor(0x5865F2).setTitle('🎫 Purchase Ticket')
    .setDescription('Select a product from the menu below. Staff will confirm availability and the final price before you pay.')
    .setFooter({ text: STORE_NAME });
  await channel.send({ content: `${i.user} ${SUPPORT_ROLE_ID ? `<@&${SUPPORT_ROLE_ID}>` : 'Store staff'}`, embeds: [intro], components: [...productMenu(), ...ticketControls()] });
  return i.reply({ content: `Your private ticket is ready: ${channel}`, ephemeral: true });
}
async function showPayment(i) {
  const lines = [];
  if (ESEWA_ID) lines.push(`**eSewa:** ${ESEWA_ID}`);
  if (KHALTI_ID) lines.push(`**Khalti:** ${KHALTI_ID}`);
  if (FONEPAY_INFO) lines.push(`**Fonepay:** ${FONEPAY_INFO}`);
  if (!lines.length) lines.push('Payment details have not been configured. Please wait for staff.');
  return i.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('💳 Payment Instructions')
    .setDescription(`${lines.join('\n')}\n\n${PAYMENT_NOTE}\n\nAfter payment, use **I Have Paid** and submit your transaction reference. Staff verifies payments manually.`)], ephemeral: true });
}
async function closeTicket(i) {
  const ch = i.channel;
  if (!ch?.topic?.includes('ticket-owner:')) return i.reply({ content: 'Use this inside a purchase ticket.', ephemeral: true });
  const owner = ch.topic.match(/ticket-owner:(\d+)/)?.[1];
  if (i.user.id !== owner && !isStaff(i)) return i.reply({ content: 'Only the ticket owner or staff can close this ticket.', ephemeral: true });
  const order = orders.find(o => o.channelId === ch.id && o.status !== 'closed');
  if (order) { order.status = 'closed'; saveOrders(); }
  await i.reply({ content: '🔒 Ticket closed. This channel will be deleted in 10 seconds.' });
  setTimeout(() => ch.delete('Ticket closed').catch(() => {}), 10000);
}
function findProduct(name) { return products.find(p => p.name.toLowerCase() === name.toLowerCase()); }

client.once(Events.ClientReady, c => console.log(`Online as ${c.user.tag}`));
client.on(Events.InteractionCreate, async i => {
  try {
    if (i.isChatInputCommand()) {
      const ch = i.channel;
      if (i.commandName === 'setup-panel') {
        await ch.send({ embeds: [productEmbed()], components: panelRows() });
        return i.reply({ content: '✅ Product Details panel posted.', ephemeral: true });
      }
      if (i.commandName === 'add-product') {
        if (!isStaff(i)) return i.reply({ content: 'Staff only.', ephemeral: true });
        if (products.length >= 25) return i.reply({ content: 'Maximum 25 products supported. Delete one before adding another.', ephemeral: true });
        const name = i.options.getString('name').trim();
        if (findProduct(name)) return i.reply({ content: 'That product already exists.', ephemeral: true });
        const image = i.options.getString('image') || '';
        if (image && !isHttpUrl(image)) return i.reply({ content: 'Image must be a valid HTTP or HTTPS URL.', ephemeral: true });
        products.push({ name, price: i.options.getString('price'), stock: i.options.getString('stock'), emoji: i.options.getString('emoji') || '📦', image });
        saveProducts();
        return i.reply({ content: `✅ Added **${name}**. Run /setup-panel again to post the updated panel.`, ephemeral: true });
      }
      if (i.commandName === 'edit-product') {
        if (!isStaff(i)) return i.reply({ content: 'Staff only.', ephemeral: true });
        const p = findProduct(i.options.getString('name'));
        if (!p) return i.reply({ content: 'Product not found. Use its exact name.', ephemeral: true });
        const price = i.options.getString('price'), stock = i.options.getString('stock'), emoji = i.options.getString('emoji'), image = i.options.getString('image');
        if (image && !isHttpUrl(image)) return i.reply({ content: 'Image must be a valid HTTP or HTTPS URL.', ephemeral: true });
        if (price !== null) p.price = price;
        if (stock !== null) p.stock = stock;
        if (emoji !== null) p.emoji = emoji;
        if (image !== null) p.image = image;
        saveProducts();
        return i.reply({ content: `✅ Updated **${p.name}**. Run /setup-panel to post the updated panel.`, ephemeral: true });
      }
      if (i.commandName === 'delete-product') {
        if (!isStaff(i)) return i.reply({ content: 'Staff only.', ephemeral: true });
        const name = i.options.getString('name'), before = products.length;
        products = products.filter(p => p.name.toLowerCase() !== name.toLowerCase());
        if (products.length === before) return i.reply({ content: 'Product not found.', ephemeral: true });
        saveProducts();
        return i.reply({ content: `🗑️ Deleted **${name}**. Run /setup-panel to post the updated panel.`, ephemeral: true });
      }
      if (i.commandName === 'close-ticket') return closeTicket(i);
      if (i.commandName === 'payment-info') return showPayment(i);
      if (i.commandName === 'mark-paid') {
        if (!isStaff(i)) return i.reply({ content: 'Staff only.', ephemeral: true });
        const o = orders.find(x => x.channelId === ch.id && x.status !== 'closed');
        if (!o) return i.reply({ content: 'No active order in this ticket.', ephemeral: true });
        o.status = 'paid'; o.paidAt = new Date().toISOString(); saveOrders();
        await log(i.guild, `Payment marked paid: ${o.id} · ${o.product} · ${o.userId}`);
        return i.reply({ content: `✅ Order ${o.id} marked paid. Staff can now use /deliver.` });
      }
      if (i.commandName === 'deliver') {
        if (!isStaff(i)) return i.reply({ content: 'Staff only.', ephemeral: true });
        const o = orders.find(x => x.channelId === ch.id && x.status !== 'closed');
        if (!o) return i.reply({ content: 'No active order in this ticket.', ephemeral: true });
        if (o.status !== 'paid') return i.reply({ content: 'Mark payment as paid first with /mark-paid.', ephemeral: true });
        const details = i.options.getString('details');
        const member = await i.guild.members.fetch(o.userId).catch(() => null);
        await ch.send({ content: `🎉 **Order delivered to ${member || `<@${o.userId}>`}**\n${details}\n\nPlease confirm receipt. Never share passwords or OTPs.` });
        o.status = 'delivered'; o.deliveredAt = new Date().toISOString(); saveOrders();
        await log(i.guild, `Delivered: ${o.id} · ${o.product} · ${o.userId}`);
        return i.reply({ content: `Delivery recorded for order ${o.id}.`, ephemeral: true });
      }
      if (i.commandName === 'order-status') {
        if (!isStaff(i)) return i.reply({ content: 'Staff only.', ephemeral: true });
        const o = orders.find(x => x.channelId === ch.id && x.status !== 'closed');
        return i.reply({ content: o ? `Order **${o.id}** · **${o.product}** · **${o.price}** · Status: **${o.status}** · Customer: <@${o.userId}>` : 'No active order in this ticket.', ephemeral: true });
      }
      if (i.commandName === 'review') {
        const o = orders.find(x => x.userId === i.user.id && x.status === 'delivered');
        if (!o) return i.reply({ content: 'You can review after a delivered order.', ephemeral: true });
        const rating = i.options.getInteger('rating'), comment = i.options.getString('comment') || 'No comment';
        reviews.push({ userId: i.user.id, rating, comment, createdAt: new Date().toISOString() }); writeJson(REVIEWS_FILE, reviews);
        await log(i.guild, `⭐ Review ${rating}/5 from ${i.user.tag}: ${comment}`);
        return i.reply({ content: 'Thank you for your review!', ephemeral: true });
      }
      if (i.commandName === 'warranty') {
        const details = i.options.getString('details');
        await log(i.guild, `Warranty request from ${i.user.tag}: ${details}`);
        return i.reply({ content: 'Warranty request recorded. Please open a purchase ticket and share your order ID with staff.', ephemeral: true });
      }
    }

    if (i.isButton()) {
      if (i.customId === 'buy_now') return createTicket(i);
      if (i.customId === 'view_stock') {
        const desc = products.map(p => `${p.emoji || '📦'} **${p.name}** — ${p.stock || 'Ask staff'}`).join('\n') || 'No products added yet.';
        return i.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('📦 Product Stock').setDescription(desc).setFooter({ text: 'Confirm availability with staff before paying.' })], ephemeral: true });
      }
      if (i.customId === 'payment_info') return showPayment(i);
      if (i.customId === 'close_ticket') return closeTicket(i);
      if (i.customId === 'paid_submit') {
        const modal = new ModalBuilder().setCustomId('payment_reference').setTitle('Submit payment reference');
        const input = new TextInputBuilder().setCustomId('reference').setLabel('Transaction ID / reference').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return i.showModal(modal);
      }
    }

    if (i.isModalSubmit() && i.customId === 'payment_reference') {
      const o = orders.find(x => x.channelId === i.channel.id && x.status !== 'closed');
      if (!o) return i.reply({ content: 'Select a product first, then submit payment.', ephemeral: true });
      if (o.userId !== i.user.id) return i.reply({ content: 'Only the ticket owner can submit a payment reference.', ephemeral: true });
      o.paymentReference = i.fields.getTextInputValue('reference'); o.status = 'payment-submitted'; o.paymentSubmittedAt = new Date().toISOString(); saveOrders();
      await log(i.guild, `Payment reference submitted for ${o.id} by ${i.user.tag}: ${o.paymentReference}`);
      return i.reply({ content: '✅ Payment reference submitted. Staff will verify it manually. Never send passwords or OTPs.', ephemeral: true });
    }

    if (i.isStringSelectMenu() && i.customId === 'choose_product') {
      const owner = i.channel.topic?.match(/ticket-owner:(\d+)/)?.[1];
      if (owner !== i.user.id && !isStaff(i)) return i.reply({ content: 'Only the ticket owner or staff can select a product.', ephemeral: true });
      const p = products[Number(i.values[0])];
      if (!p) return i.reply({ content: 'Product not found. Please ask staff to reopen the ticket menu.', ephemeral: true });
      const order = { id: `ORD-${Date.now().toString(36).toUpperCase()}`, channelId: i.channel.id, userId: owner, product: p.name, price: priceText(p), status: 'pending', createdAt: new Date().toISOString() };
      orders = orders.filter(x => x.channelId !== i.channel.id || x.status === 'closed'); orders.push(order); saveOrders();
      await log(i.guild, `New order ${order.id}: ${p.name} · ${order.price} · ${owner}`);
      const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🧾 Order Details')
        .setDescription(`**Order ID:** ${order.id}\n**Product:** ${p.emoji || '📦'} ${p.name}\n**Price:** ${order.price}\n**Stock:** ${p.stock || 'Ask staff'}\n**Status:** Waiting for staff confirmation\n\nPlease wait for staff to confirm availability and payment instructions.`);
      if (p.image && isHttpUrl(p.image)) embed.setThumbnail(p.image);
      return i.reply({ embeds: [embed] });
    }
  } catch (e) {
    console.error(e);
    if (i.isRepliable()) {
      const msg = 'Something went wrong. Check Render logs and bot permissions.';
      if (i.deferred || i.replied) await i.followUp({ content: msg, ephemeral: true }).catch(() => {});
      else await i.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
});

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
console.log('Slash commands registered.');
client.login(DISCORD_TOKEN);
