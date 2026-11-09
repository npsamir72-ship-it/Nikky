import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, Client,
  EmbedBuilder, Events, GatewayIntentBits, ModalBuilder, PermissionFlagsBits, REST,
  Routes, SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle
} from 'discord.js';

// --- RENDER PORT BINDING (Fixes Port Timeout Error) ---
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Discord bot is active.\n');
}).listen(PORT, '0.0.0.0', () => {
  console.log(`HTTP keep-alive listening on 0.0.0.0:${PORT}`);
});

// --- CONFIGURATION & ENV ---
const {
  DISCORD_TOKEN, CLIENT_ID, GUILD_ID, SUPPORT_ROLE_ID = '', TICKET_CATEGORY_ID = '',
  LOG_CHANNEL_ID = '', STORE_NAME = 'Access Hub', CURRENCY = 'NPR',
  STORE_LOGO_URL = '', STORE_BANNER_URL = '', ESEWA_ID = '9746370454', KHALTI_ID = '9746370454',
  FONEPAY_INFO = '', PAYMENT_NOTE = 'Pay only after staff confirms your order.',
  WARRANTY_TEXT = 'Your product comes with the warranty stated by staff. Refunds or replacements are handled only for valid product issues.'
} = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error('Missing required environment variables: DISCORD_TOKEN, CLIENT_ID, and GUILD_ID');
}

// --- DATA PERSISTENCE ---
const DATA_DIR = new URL('./data/', import.meta.url);
const PRODUCTS_FILE = new URL('./products.json', import.meta.url);
const ORDERS_FILE = new URL('./data/orders.json', import.meta.url);
const REVIEWS_FILE = new URL('./data/reviews.json', import.meta.url);
const SETTINGS_FILE = new URL('./data/store-settings.json', import.meta.url);

fs.mkdirSync(DATA_DIR, { recursive: true });

const readJson = (url, fallback) => {
  try { return JSON.parse(fs.readFileSync(url, 'utf8')); }
  catch { return fallback; }
};

const writeJson = (url, value) => {
  try { fs.writeFileSync(url, JSON.stringify(value, null, 2), 'utf8'); }
  catch (err) { console.error(`Error writing to ${url.pathname}:`, err); }
};

let products = readJson(PRODUCTS_FILE, []).map(p => ({ emoji: '📦', image: '', ...p }));
let orders = readJson(ORDERS_FILE, []);
let reviews = readJson(REVIEWS_FILE, []);
let storeSettings = readJson(SETTINGS_FILE, { logoUrl: STORE_LOGO_URL, bannerUrl: STORE_BANNER_URL });

const saveProducts = () => writeJson(PRODUCTS_FILE, products);
const saveOrders = () => writeJson(ORDERS_FILE, orders);
const saveReviews = () => writeJson(REVIEWS_FILE, reviews);
const saveSettings = () => writeJson(SETTINGS_FILE, storeSettings);

const activeClosures = new Map();

// --- CLIENT SETUP ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// --- SLASH COMMANDS DEFINITIONS ---
const commands = [
  new SlashCommandBuilder().setName('setup-panel').setDescription('Post the store showcase panel').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('add-product').setDescription('Add a new product')
    .addStringOption(o => o.setName('name').setDescription('Product name').setRequired(true))
    .addStringOption(o => o.setName('price').setDescription('Example: 499 or 4.99 USD').setRequired(true))
    .addStringOption(o => o.setName('stock').setDescription('Stock description (e.g., In Stock, 5 left, Instant)').setRequired(true))
    .addStringOption(o => o.setName('emoji').setDescription('Display emoji').setRequired(false))
    .addStringOption(o => o.setName('image').setDescription('Direct image URL').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('edit-product').setDescription('Edit an existing product')
    .addStringOption(o => o.setName('name').setDescription('Select product').setAutocomplete(true).setRequired(true))
    .addStringOption(o => o.setName('price').setDescription('New price').setRequired(false))
    .addStringOption(o => o.setName('stock').setDescription('New stock label').setRequired(false))
    .addStringOption(o => o.setName('emoji').setDescription('New emoji').setRequired(false))
    .addStringOption(o => o.setName('image').setDescription('New image URL').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('delete-product').setDescription('Remove a product from store')
    .addStringOption(o => o.setName('name').setDescription('Select product to delete').setAutocomplete(true).setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('set-image').setDescription('Set/update product thumbnail image')
    .addStringOption(o => o.setName('product').setDescription('Select product').setAutocomplete(true).setRequired(true))
    .addStringOption(o => o.setName('image').setDescription('Direct image URL').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('set-logo').setDescription('Set store logo image')
    .addStringOption(o => o.setName('image').setDescription('Direct image URL').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('set-banner').setDescription('Set store banner image')
    .addStringOption(o => o.setName('image').setDescription('Direct image URL').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('close-ticket').setDescription('Close and archive this purchase ticket')
    .addStringOption(o => o.setName('reason').setDescription('Reason for closing').setRequired(false)),
  new SlashCommandBuilder().setName('payment-info').setDescription('View configured payment channels'),
  new SlashCommandBuilder().setName('mark-paid').setDescription('Staff: Confirm payment received')
    .addStringOption(o => o.setName('order_id').setDescription('Order ID (optional if run inside ticket)').setRequired(false)),
  new SlashCommandBuilder().setName('deliver').setDescription('Staff: Deliver product contents to the customer')
    .addStringOption(o => o.setName('details').setDescription('Credentials, keys, or download link').setRequired(true))
    .addStringOption(o => o.setName('order_id').setDescription('Order ID (optional if run inside ticket)').setRequired(false)),
  new SlashCommandBuilder().setName('order-status').setDescription('Check current order status')
    .addStringOption(o => o.setName('order_id').setDescription('Order ID (optional)').setRequired(false)),
  new SlashCommandBuilder().setName('orders').setDescription('Staff: List all pending and active orders')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('review').setDescription('Leave a verified customer review')
    .addIntegerOption(o => o.setName('rating').setDescription('Rate from 1 to 5 stars').setMinValue(1).setMaxValue(5).setRequired(true))
    .addStringOption(o => o.setName('comment').setDescription('Your experience / review comment').setRequired(false)),
  new SlashCommandBuilder().setName('reviews').setDescription('Browse latest store reviews and ratings'),
  new SlashCommandBuilder().setName('warranty').setDescription('Open a warranty support inquiry')
    .addStringOption(o => o.setName('details').setDescription('Explain the issue (no passwords/OTPs)').setRequired(true))
].map(c => c.toJSON());

// --- UTILITY FUNCTIONS ---
function isStaff(i) {
  return Boolean(
    i.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
    (SUPPORT_ROLE_ID && i.member?.roles?.cache?.has(SUPPORT_ROLE_ID))
  );
}

function isHttpUrl(val) {
  try {
    const u = new URL(val);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function priceText(p) {
  const raw = String(p.price ?? 'N/A');
  return /[a-z€$₹]/i.test(raw) ? raw : `${raw} ${CURRENCY}`;
}

function findProduct(name) {
  return products.find(p => p.name.toLowerCase() === name.trim().toLowerCase());
}

async function log(guild, message, embed, files = []) {
  if (!LOG_CHANNEL_ID) return;
  const ch = await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
  if (ch?.isTextBased()) {
    await ch.send({
      content: message || undefined,
      embeds: embed ? [embed] : [],
      files
    }).catch(console.error);
  }
}

// --- UI BUILDERS ---
function productEmbed() {
  const list = products.length
    ? products.map(p => `${p.emoji || '📦'} **${p.name}** — \`${priceText(p)}\` • *${p.stock || 'Available'}*`).join('\n')
    : 'No products added yet. Staff can add items using `/add-product`.';

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`🛒 Welcome to ${STORE_NAME}`)
    .setDescription(`Browse available products and open a ticket to place an order.\n\n━━━━━━━━━━━━━━━━━━━━\n${list}\n━━━━━━━━━━━━━━━━━━━━\n\n🛡️ **Warranty Policy:**\n${WARRANTY_TEXT}`)
    .setFooter({ text: `${STORE_NAME} • Secure Purchases & Instant Service` })
    .setTimestamp();

  if (storeSettings.logoUrl && isHttpUrl(storeSettings.logoUrl)) embed.setThumbnail(storeSettings.logoUrl);
  if (storeSettings.bannerUrl && isHttpUrl(storeSettings.bannerUrl)) embed.setImage(storeSettings.bannerUrl);
  return embed;
}

function panelRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('buy_now').setLabel('Buy Now / Open Ticket').setEmoji('🛒').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('view_stock').setLabel('Stock Overview').setEmoji('📦').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('store_reviews').setLabel('Reviews').setEmoji('⭐').setStyle(ButtonStyle.Secondary)
    )
  ];
}

function productMenu() {
  const options = products.slice(0, 25).map((p, i) => ({
    label: p.name.slice(0, 100),
    description: `${priceText(p)} • Stock: ${p.stock || 'Ask staff'}`.slice(0, 100),
    value: String(i),
    ...(p.emoji ? { emoji: p.emoji } : {})
  }));

  return options.length
    ? [new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('choose_product').setPlaceholder('Choose a product to purchase...').addOptions(options)
      )]
    : [];
}

function ticketControls() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('payment_info').setLabel('Payment Methods').setEmoji('💳').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('paid_submit').setLabel('I Have Paid').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger)
    )
  ];
}

function staffControls() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('btn_mark_paid').setLabel('Mark Paid').setEmoji('💰').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('btn_deliver').setLabel('Deliver').setEmoji('🚀').setStyle(ButtonStyle.Primary)
    )
  ];
}

// --- CORE ACTIONS ---
async function createTicket(i) {
  const guild = i.guild;
  const existing = guild.channels.cache.find(
    c => c.type === ChannelType.GuildText && c.topic?.includes(`ticket-owner:${i.user.id}`)
  );
  if (existing) {
    return i.reply({ content: `You already have an active ticket open: ${existing}`, ephemeral: true });
  }

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
  ];
  if (SUPPORT_ROLE_ID) {
    overwrites.push({ id: SUPPORT_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  }

  const cleanName = i.user.username.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 20) || 'customer';
  const channel = await guild.channels.create({
    name: `ticket-${cleanName}-${i.user.id.slice(-4)}`,
    type: ChannelType.GuildText,
    topic: `Purchase ticket | ticket-owner:${i.user.id}`,
    parent: TICKET_CATEGORY_ID || undefined,
    permissionOverwrites: overwrites
  });

  const introEmbed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`🎫 ${STORE_NAME} Ticket Support`)
    .setDescription(`Welcome ${i.user}! Please select the product you want to buy from the dropdown menu below.\n\nOur staff team will verify stock and guide you through payment.`)
    .setFooter({ text: 'Do not send sensitive credentials or OTP codes.' });

  await channel.send({
    content: `${i.user} ${SUPPORT_ROLE_ID ? `<@&${SUPPORT_ROLE_ID}>` : ''}`,
    embeds: [introEmbed],
    components: [...productMenu(), ...ticketControls()]
  });

  return i.reply({ content: `Your ticket has been created: ${channel}`, ephemeral: true });
}

async function showPayment(i) {
  const lines = [];
  if (ESEWA_ID) lines.push(`📱 **eSewa ID:** \`${ESEWA_ID}\``);
  if (KHALTI_ID) lines.push(`🟣 **Khalti ID:** \`${KHALTI_ID}\``);
  if (FONEPAY_INFO) lines.push(`🏦 **Fonepay:** \`${FONEPAY_INFO}\``);
  if (!lines.length) lines.push('Payment methods are not configured yet. Please ask staff in this channel.');

  const embed = new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle('💳 Store Payment Methods')
    .setDescription(`${lines.join('\n')}\n\n⚠️ **Notice:** ${PAYMENT_NOTE}\n\n*Click **I Have Paid** below after your transaction to submit your payment reference.*`);

  return i.reply({ embeds: [embed], ephemeral: true });
}

async function generateTranscript(channel) {
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) return null;
  const transcriptLines = messages.reverse().map(m => {
    const time = new Date(m.createdTimestamp).toISOString().replace('T', ' ').slice(0, 19);
    const attachments = m.attachments.map(a => a.url).join(' ');
    return `[${time}] ${m.author.tag}: ${m.cleanContent} ${attachments}`.trim();
  });
  return Buffer.from(transcriptLines.join('\n'), 'utf8');
}

async function closeTicket(i, reason = 'Completed') {
  const ch = i.channel;
  if (!ch?.topic?.includes('ticket-owner:')) {
    return i.reply({ content: 'This command can only be used inside a purchase ticket channel.', ephemeral: true });
  }

  const ownerId = ch.topic.match(/ticket-owner:(\d+)/)?.[1];
  if (i.user.id !== ownerId && !isStaff(i)) {
    return i.reply({ content: 'Only the ticket owner or staff members can close this ticket.', ephemeral: true });
  }

  if (activeClosures.has(ch.id)) {
    return i.reply({ content: 'This ticket is already scheduled for closure.', ephemeral: true });
  }

  await i.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🔒 Ticket Closing')
        .setDescription(`Ticket closed by ${i.user}. This channel will be removed in **10 seconds**.\n**Reason:** ${reason}`)
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cancel_close').setLabel('Cancel Deletion').setStyle(ButtonStyle.Secondary)
      )
    ]
  });

  const timer = setTimeout(async () => {
    activeClosures.delete(ch.id);
    const order = orders.find(o => o.channelId === ch.id && o.status !== 'closed');
    if (order) {
      order.status = 'closed';
      order.closedAt = new Date().toISOString();
      saveOrders();
    }

    const transcriptBuffer = await generateTranscript(ch);
    const files = transcriptBuffer ? [new AttachmentBuilder(transcriptBuffer, { name: `${ch.name}-transcript.txt` })] : [];
    const logEmbed = new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle(`📁 Ticket Closed: ${ch.name}`)
      .addFields(
        { name: 'Customer ID', value: `<@${ownerId}> (${ownerId})`, inline: true },
        { name: 'Closed By', value: `${i.user.tag}`, inline: true },
        { name: 'Reason', value: reason, inline: true }
      )
      .setTimestamp();

    await log(i.guild, '', logEmbed, files);
    await ch.delete(`Ticket closed by ${i.user.tag}`).catch(() => {});
  }, 10000);

  activeClosures.set(ch.id, timer);
}

// --- EVENT HANDLERS ---
client.once(Events.ClientReady, async c => {
  console.log(`[BOT] Authenticated as ${c.user.tag}`);
  try {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('[BOT] Successfully re-registered slash commands.');
  } catch (err) {
    console.error('[BOT] Error registering commands:', err);
  }
});

client.on(Events.InteractionCreate, async i => {
  try {
    // Autocomplete
    if (i.isAutocomplete()) {
      const focused = i.options.getFocused(true);
      if (['name', 'product'].includes(focused.name)) {
        const query = focused.value.toLowerCase();
        const matches = products
          .filter(p => p.name.toLowerCase().includes(query))
          .slice(0, 25)
          .map(p => ({ name: `${p.emoji || '📦'} ${p.name} (${priceText(p)})`, value: p.name }));
        return i.respond(matches);
      }
      return;
    }

    // Slash Commands
    if (i.isChatInputCommand()) {
      const ch = i.channel;

      if (i.commandName === 'setup-panel') {
        await ch.send({ embeds: [productEmbed()], components: panelRows() });
        return i.reply({ content: '✅ Store display panel posted successfully.', ephemeral: true });
      }

      if (i.commandName === 'add-product') {
        if (!isStaff(i)) return i.reply({ content: 'Staff only.', ephemeral: true });
        if (products.length >= 25) return i.reply({ content: 'Maximum limit of 25 products reached.', ephemeral: true });
        const name = i.options.getString('name').trim();
        if (findProduct(name)) return i.reply({ content: 'A product with this name already exists.', ephemeral: true });
        const image = i.options.getString('image') || '';
        if (image && !isHttpUrl(image)) return i.reply({ content: 'Please provide a valid HTTP/HTTPS image URL.', ephemeral: true });

        products.push({
          name,
          price: i.options.getString('price'),
          stock: i.options.getString('stock'),
          emoji: i.options.getString('emoji') || '📦',
          image
        });
        saveProducts();
        return i.reply({ content: `✅ Added **${name}** to catalogue.`, ephemeral: true });
      }

      if (i.commandName === 'edit-product') {
        if (!isStaff(i)) return i.reply({ content: 'Staff only.', ephemeral: true });
        const p = findProduct(i.options.getString('name'));
        if (!p) return i.reply({ content: 'Product not found.', ephemeral: true });

        const price = i.options.getString('price');
        const stock = i.options.getString('stock');
        const emoji = i.options.getString('emoji');
        const image = i.options.getString('image');

        if (image && !isHttpUrl(image)) return i.reply({ content: 'Image URL must be valid HTTP/HTTPS.', ephemeral: true });
        if (price !== null) p.price = price;
        if (stock !== null) p.stock = stock;
        if (emoji !== null) p.emoji = emoji;
        if (image !== null) p.image = image;

        saveProducts();
        return i.reply({ content: `✅ Successfully updated **${p.name}**.`, ephemeral: true });
      }

      if (i.commandName === 'delete-product') {
        if (!isStaff(i)) return i.reply({ content: 'Staff only.', ephemeral: true });
        const name = i.options.getString('name');
        const countBefore = products.length;
        products = products.filter(p => p.name.toLowerCase() !== name.toLowerCase());
        if (products.length === countBefore) return i.reply({ content: 'Product not found.', ephemeral: true });

        saveProducts();
        return i.reply({ content: `🗑️ Deleted **${name}**.`, ephemeral: true });
      }

      if (i.commandName === 'set-image') {
        if (!isStaff(i)) return i.reply({ content: 'Staff only.', ephemeral: true });
        const p = findProduct(i.options.getString('product'));
        const image = i.options.getString('image');
        if (!p) return i.reply({ content: 'Product not found.', ephemeral: true });
        if (!isHttpUrl(image)) return i.reply({ content: 'Invalid HTTP/HTTPS image URL.', ephemeral: true });

        p.image = image;
        saveProducts();
        return i.reply({ content: `🖼️ Image updated for **${p.name}**.`, ephemeral: true });
      }

      if (i.commandName === 'set-logo' || i.commandName === 'set-banner') {
        if (!isStaff(i)) return i.reply({ content: 'Staff only.', ephemeral: true });
        const image = i.options.getString('image');
        if (!isHttpUrl(image)) return i.reply({ content: 'Invalid image URL.', ephemeral: true });

        if (i.commandName === 'set-logo') storeSettings.logoUrl = image;
        else storeSettings.bannerUrl = image;
        saveSettings();
        return i.reply({ content: `✅ Updated store ${i.commandName === 'set-logo' ? 'logo' : 'banner'}.`, ephemeral: true });
      }

      if (i.commandName === 'close-ticket') {
        return closeTicket(i, i.options.getString('reason') || 'Completed');
      }

      if (i.commandName === 'payment-info') {
        return showPayment(i);
      }

      if (i.commandName === 'mark-paid') {
        if (!isStaff(i)) return i.reply({ content: 'Staff only.', ephemeral: true });
        const orderId = i.options.getString('order_id');
        const o = orderId
          ? orders.find(x => x.id === orderId)
          : orders.find(x => x.channelId === ch.id && x.status !== 'closed');

        if (!o) return i.reply({ content: 'No active order found.', ephemeral: true });

        o.status = 'paid';
        o.paidAt = new Date().toISOString();
        saveOrders();

        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('💰 Payment Confirmed')
          .setDescription(`Order **${o.id}** (${o.product}) has been marked as **PAID** by ${i.user}. Staff can now deliver the item.`)
          .setTimestamp();

        await ch.send({ embeds: [embed] }).catch(() => {});

        const member = await i.guild.members.fetch(o.userId).catch(() => null);
        if (member) {
          await member.send({
            content: `✅ Your payment for Order **${o.id}** (**${o.product}**) has been received! Our staff will deliver your order shortly.`
          }).catch(() => {});
        }

        await log(i.guild, `Payment verified for Order \`${o.id}\` by ${i.user.tag}`);
        return i.reply({ content: `✅ Order **${o.id}** marked as paid.`, ephemeral: true });
      }

      if (i.commandName === 'deliver') {
        if (!isStaff(i)) return i.reply({ content: 'Staff only.', ephemeral: true });
        const orderId = i.options.getString('order_id');
        const o = orderId
          ? orders.find(x => x.id === orderId)
          : orders.find(x => x.channelId === ch.id && x.status !== 'closed');

        if (!o) return i.reply({ content: 'No active order found.', ephemeral: true });
        if (o.status !== 'paid') return i.reply({ content: 'Order is not marked as paid yet. Run /mark-paid first.', ephemeral: true });

        const details = i.options.getString('details');
        o.status = 'delivered';
        o.deliveredAt = new Date().toISOString();
        saveOrders();

        const deliveryEmbed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('📦 Order Delivered!')
          .setDescription(`**Product:** ${o.product}\n**Details / Keys:**\n\`\`\`\n${details}\n\`\`\``)
          .addFields({ name: 'Warranty Note', value: WARRANTY_TEXT })
          .setFooter({ text: 'Thank you for your order! Run /review to leave your feedback.' });

        await ch.send({ content: `<@${o.userId}>`, embeds: [deliveryEmbed] });

        const member = await i.guild.members.fetch(o.userId).catch(() => null);
        if (member) {
          await member.send({
            content: `🎉 Your order **${o.id}** has been delivered in ${ch}!\nUse \`/review\` in the server to leave your feedback.`
          }).catch(() => {});
        }

        await log(i.guild, `Delivered Order \`${o.id}\` to <@${o.userId}> by ${i.user.tag}`);
        return i.reply({ content: `Delivery logged for Order **${o.id}**.`, ephemeral: true });
      }

      if (i.commandName === 'order-status') {
        const orderId = i.options.getString('order_id');
        const o = orderId
          ? orders.find(x => x.id === orderId)
          : orders.find(x => x.channelId === ch.id && x.status !== 'closed');

        if (!o) return i.reply({ content: 'No order found matching your criteria.', ephemeral: true });

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle(`Status for Order ${o.id}`)
          .addFields(
            { name: 'Customer', value: `<@${o.userId}>`, inline: true },
            { name: 'Product', value: `${o.product} (${o.price})`, inline: true },
            { name: 'Status', value: `\`${o.status.toUpperCase()}\``, inline: true },
            { name: 'Payment Reference', value: o.paymentReference || 'None submitted', inline: false }
          )
          .setTimestamp();

        return i.reply({ embeds: [embed] });
      }

      if (i.commandName === 'orders') {
        if (!isStaff(i)) return i.reply({ content: 'Staff only.', ephemeral: true });
        const open = orders.filter(x => x.status !== 'closed').slice(-15);
        if (!open.length) return i.reply({ content: 'No active orders found.', ephemeral: true });

        const lines = open.map(o => `• **${o.id}** | <@${o.userId}> | **${o.product}** | Status: \`${o.status}\``);
        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('📋 Active Store Orders')
          .setDescription(lines.join('\n'));
        return i.reply({ embeds: [embed], ephemeral: true });
      }

      if (i.commandName === 'review') {
        const userOrders = orders.filter(x => x.userId === i.user.id && x.status === 'delivered');
        if (!userOrders.length) {
          return i.reply({ content: 'You can only leave a review after purchasing and receiving a delivered order.', ephemeral: true });
        }

        const rating = i.options.getInteger('rating');
        const comment = i.options.getString('comment') || 'No comment provided';

        reviews.push({
          userId: i.user.id,
          username: i.user.username,
          rating,
          comment,
          createdAt: new Date().toISOString()
        });
        saveReviews();

        await log(i.guild, `⭐ **New Review (${rating}/5)** from ${i.user.tag}: "${comment}"`);
        return i.reply({ content: '🌟 Thank you for your review and feedback!', ephemeral: true });
      }

      if (i.commandName === 'reviews') {
        if (!reviews.length) return i.reply({ content: 'No reviews submitted yet.', ephemeral: true });
        const avg = (reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length).toFixed(1);
        const recent = reviews.slice(-5).reverse().map(r => `**${'⭐'.repeat(r.rating)}** by <@${r.userId}>\n*"${r.comment}"*`).join('\n\n');

        const embed = new EmbedBuilder()
          .setColor(0xFEE75C)
          .setTitle(`⭐ ${STORE_NAME} Reviews`)
          .setDescription(`**Average Rating:** ${avg} / 5.0 (${reviews.length} reviews)\n\n━━━━━━━━━━━━━━━━━━━━\n${recent}`)
          .setTimestamp();

        return i.reply({ embeds: [embed] });
      }

      if (i.commandName === 'warranty') {
        const details = i.options.getString('details');
        const userOrders = orders.filter(x => x.userId === i.user.id);
        const latestOrder = userOrders[userOrders.length - 1];

        const embed = new EmbedBuilder()
          .setColor(0xFEE75C)
          .setTitle('🛡️ Warranty Support Request')
          .addFields(
            { name: 'User', value: `${i.user.tag} (<@${i.user.id}>)`, inline: true },
            { name: 'Last Known Order', value: latestOrder?.id || 'None on record', inline: true },
            { name: 'Details', value: details }
          )
          .setTimestamp();

        await log(i.guild, '', embed);
        return i.reply({ content: 'Your warranty inquiry has been forwarded to store administrators. Please keep an active ticket open to receive assistance.', ephemeral: true });
      }
    }

    // Buttons
    if (i.isButton()) {
      if (i.customId === 'buy_now') return createTicket(i);
      if (i.customId === 'payment_info') return showPayment(i);
      if (i.customId === 'close_ticket') return closeTicket(i);

      if (i.customId === 'view_stock') {
        const stockList = products.map(p => `${p.emoji || '📦'} **${p.name}** — ${p.stock || 'In Stock'}`).join('\n') || 'No products listed.';
        return i.reply({
          embeds: [
            new EmbedBuilder().setColor(0x5865F2).setTitle('📦 Current Product Stock').setDescription(stockList)
          ],
          ephemeral: true
        });
      }

      if (i.customId === 'store_reviews') {
        if (!reviews.length) return i.reply({ content: 'No reviews yet.', ephemeral: true });
        const avg = (reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length).toFixed(1);
        const embed = new EmbedBuilder()
          .setColor(0xFEE75C)
          .setTitle(`⭐ Reviews — ${avg} / 5.0`)
          .setDescription(reviews.slice(-5).map(r => `${'⭐'.repeat(r.rating)} — *"${r.comment}"*`).join('\n\n'));
        return i.reply({ embeds: [embed], ephemeral: true });
      }

      if (i.customId === 'cancel_close') {
        if (!activeClosures.has(i.channel.id)) return i.reply({ content: 'No pending closure found.', ephemeral: true });
        clearTimeout(activeClosures.get(i.channel.id));
        activeClosures.delete(i.channel.id);
        return i.reply({ content: '🛑 Ticket closure has been cancelled.' });
      }

      if (i.customId === 'paid_submit') {
        const modal = new ModalBuilder()
          .setCustomId('payment_reference_modal')
          .setTitle('Submit Payment Reference');
        const input = new TextInputBuilder()
          .setCustomId('reference')
          .setLabel('Transaction ID / Ref Code / Sender Details')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return i.showModal(modal);
      }

      if (i.customId === 'btn_mark_paid') {
        if (!isStaff(i)) return i.reply({ content: 'Staff only.', ephemeral: true });
        const o = orders.find(x => x.channelId === i.channel.id && x.status !== 'closed');
        if (!o) return i.reply({ content: 'No active order found in this ticket.', ephemeral: true });
        o.status = 'paid';
        o.paidAt = new Date().toISOString();
        saveOrders();
        await log(i.guild, `Payment verified for Order \`${o.id}\` by ${i.user.tag}`);
        return i.reply({ content: `✅ Order **${o.id}** marked as paid. You can now use \`/deliver\`.` });
      }

      if (i.customId === 'btn_deliver') {
        if (!isStaff(i)) return i.reply({ content: 'Staff only.', ephemeral: true });
        const modal = new ModalBuilder().setCustomId('deliver_modal').setTitle('Deliver Product Content');
        const input = new TextInputBuilder()
          .setCustomId('details')
          .setLabel('Delivery Credentials / Keys')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return i.showModal(modal);
      }
    }

    // Modal Submits
    if (i.isModalSubmit()) {
      if (i.customId === 'payment_reference_modal') {
        const o = orders.find(x => x.channelId === i.channel.id && x.status !== 'closed');
        if (!o) return i.reply({ content: 'Please select a product from the menu first.', ephemeral: true });

        const ref = i.fields.getTextInputValue('reference');
        o.paymentReference = ref;
        o.status = 'payment-submitted';
        o.paymentSubmittedAt = new Date().toISOString();
        saveOrders();

        const embed = new EmbedBuilder()
          .setColor(0xFEE75C)
          .setTitle('💳 Payment Submitted')
          .setDescription(`Customer submitted payment details:\n**Reference:** \`${ref}\`\n\nStaff will verify the transaction shortly.`)
          .setTimestamp();

        await i.channel.send({ embeds: [embed], components: staffControls() });
        await log(i.guild, `Payment reference submitted for Order \`${o.id}\` by ${i.user.tag}: ${ref}`);
        return i.reply({ content: '✅ Payment reference recorded. Staff will verify it shortly.', ephemeral: true });
      }

      if (i.customId === 'deliver_modal') {
        const o = orders.find(x => x.channelId === i.channel.id && x.status !== 'closed');
        if (!o) return i.reply({ content: 'No active order found in this ticket.', ephemeral: true });

        const details = i.fields.getTextInputValue('details');
        o.status = 'delivered';
        o.deliveredAt = new Date().toISOString();
        saveOrders();

        const deliveryEmbed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('📦 Order Delivered!')
          .setDescription(`**Product:** ${o.product}\n**Details:**\n\`\`\`\n${details}\n\`\`\``)
          .addFields({ name: 'Warranty Note', value: WARRANTY_TEXT })
          .setFooter({ text: 'Run /review to leave your feedback!' });

        await i.channel.send({ content: `<@${o.userId}>`, embeds: [deliveryEmbed] });
        return i.reply({ content: `✅ Order delivered successfully to <@${o.userId}>.`, ephemeral: true });
      }
    }

    // Dropdown Select Menu
    if (i.isStringSelectMenu() && i.customId === 'choose_product') {
      const ownerId = i.channel.topic?.match(/ticket-owner:(\d+)/)?.[1];
      if (ownerId !== i.user.id && !isStaff(i)) {
        return i.reply({ content: 'Only the ticket owner or staff can select an item.', ephemeral: true });
      }

      const p = products[Number(i.values[0])];
      if (!p) return i.reply({ content: 'Selected product could not be found.', ephemeral: true });

      const order = {
        id: `ORD-${Date.now().toString(36).toUpperCase()}`,
        channelId: i.channel.id,
        userId: ownerId,
        product: p.name,
        price: priceText(p),
        status: 'pending',
        createdAt: new Date().toISOString()
      };

      orders = orders.filter(x => x.channelId !== i.channel.id || x.status === 'closed');
      orders.push(order);
      saveOrders();

      await log(i.guild, `Order \`${order.id}\` initiated: ${p.name} (${order.price}) for <@${ownerId}>`);

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🧾 Order Details')
        .addFields(
          { name: 'Order ID', value: `\`${order.id}\``, inline: true },
          { name: 'Product', value: `${p.emoji || '📦'} ${p.name}`, inline: true },
          { name: 'Amount Due', value: `\`${order.price}\``, inline: true },
          { name: 'Stock Status', value: p.stock || 'Ask staff', inline: true },
          { name: 'Status', value: '🟡 Awaiting Confirmation / Payment', inline: true }
        )
        .setDescription('Please click **Payment Methods** below to make your payment, then click **I Have Paid** to submit your transaction ID.')
        .setTimestamp();

      if (p.image && isHttpUrl(p.image)) embed.setThumbnail(p.image);
      return i.reply({ embeds: [embed] });
    }
  } catch (err) {
    console.error('Unhandled interaction error:', err);
    if (i.isRepliable()) {
      const msg = '⚠️ An unexpected error occurred while processing this action.';
      if (i.deferred || i.replied) await i.followUp({ content: msg, ephemeral: true }).catch(() => {});
      else await i.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
});

client.login(DISCORD_TOKEN);
