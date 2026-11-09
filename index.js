import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Client, EmbedBuilder,
  Events, GatewayIntentBits, ModalBuilder, PermissionFlagsBits, REST, Routes,
  SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle
} from 'discord.js';

const cfg = process.env;
const {
  DISCORD_TOKEN, CLIENT_ID, GUILD_ID, SUPPORT_ROLE_ID = '', TICKET_CATEGORY_ID = '',
  LOG_CHANNEL_ID = '', STORE_NAME = 'My Digital Store', CURRENCY = 'NPR',
  ESEWA_ID = '', KHALTI_ID = '', FONEPAY_INFO = '', PAYMENT_NOTE = 'Pay only after staff confirms your order.'
} = cfg;
if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) throw new Error('Set DISCORD_TOKEN, CLIENT_ID and GUILD_ID in .env');

const DATA = new URL('./data/', import.meta.url);
const PRODUCTS_FILE = new URL('./products.json', import.meta.url);
const ORDERS_FILE = new URL('./data/orders.json', import.meta.url);
const REVIEWS_FILE = new URL('./data/reviews.json', import.meta.url);
fs.mkdirSync(DATA, { recursive: true });
const readJson = (url, fallback) => { try { return JSON.parse(fs.readFileSync(url, 'utf8')); } catch { return fallback; } };
const writeJson = (url, value) => fs.writeFileSync(url, JSON.stringify(value, null, 2));
let products = readJson(PRODUCTS_FILE, []);
let orders = readJson(ORDERS_FILE, []);
let reviews = readJson(REVIEWS_FILE, []);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder().setName('setup-panel').setDescription('Post the store product panel').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('close-ticket').setDescription('Close this purchase ticket'),
  new SlashCommandBuilder().setName('payment-info').setDescription('Show configured payment methods in this ticket'),
  new SlashCommandBuilder().setName('mark-paid').setDescription('Staff: mark this ticket order as paid'),
  new SlashCommandBuilder().setName('deliver').setDescription('Staff: deliver product/message to the customer').addStringOption(o=>o.setName('details').setDescription('Delivery details or redemption code').setRequired(true)),
  new SlashCommandBuilder().setName('set-stock').setDescription('Staff: update a product stock label').addStringOption(o=>o.setName('product').setDescription('Exact product name').setRequired(true)).addStringOption(o=>o.setName('stock').setDescription('Example: Available / Out of stock').setRequired(true)),
  new SlashCommandBuilder().setName('set-price').setDescription('Staff: update a product price').addStringOption(o=>o.setName('product').setDescription('Exact product name').setRequired(true)).addStringOption(o=>o.setName('price').setDescription('Example: 250 NPR').setRequired(true)),
  new SlashCommandBuilder().setName('add-product').setDescription('Staff: add a product').addStringOption(o=>o.setName('name').setDescription('Product name').setRequired(true)).addStringOption(o=>o.setName('price').setDescription('Price').setRequired(true)).addStringOption(o=>o.setName('stock').setDescription('Stock label').setRequired(true)),
  new SlashCommandBuilder().setName('order-status').setDescription('Staff: show current ticket order status'),
  new SlashCommandBuilder().setName('review').setDescription('Leave a store review after purchase').addIntegerOption(o=>o.setName('rating').setDescription('Rating from 1 to 5').setMinValue(1).setMaxValue(5).setRequired(true)).addStringOption(o=>o.setName('comment').setDescription('Your feedback').setRequired(false)),
  new SlashCommandBuilder().setName('warranty').setDescription('Open a warranty/support request').addStringOption(o=>o.setName('details').setDescription('Explain the issue; never include passwords or OTPs').setRequired(true))
].map(c=>c.toJSON());

function saveProducts(){ writeJson(PRODUCTS_FILE, products); }
function saveOrders(){ writeJson(ORDERS_FILE, orders); }
function staff(interaction){
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
    (SUPPORT_ROLE_ID && interaction.member?.roles?.cache?.has(SUPPORT_ROLE_ID)));
}
function ticketOrder(channelId){ return orders.find(o=>o.channelId===channelId && !['closed'].includes(o.status)); }
function productEmbed(){
  const desc = products.length ? products.map(p=>`• **${p.name}** — ${p.price} · ${p.stock}`).join('\n') : 'No products listed yet.';
  return new EmbedBuilder().setColor(0x5865F2).setTitle(`🛍️ ${STORE_NAME}`)
    .setDescription('Choose **Buy Now** to open a private ticket.\n\n'+desc)
    .addFields({name:'Purchase & warranty',value:'Staff confirms payment and delivery in your private ticket. Warranty follows the terms shown by staff.'})
    .setFooter({text:'Never share account passwords, OTPs, or recovery codes.'}).setTimestamp();
}
function panelRows(){
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('buy_now').setLabel('Buy Now').setEmoji('🛒').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('view_stock').setLabel('View Stock').setEmoji('📦').setStyle(ButtonStyle.Secondary)
  )];
}
function productMenu(){
  return [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('choose_product')
    .setPlaceholder('Choose a product').addOptions(products.slice(0,25).map((p,i)=>({label:p.name.slice(0,100),description:`${p.price} | ${p.stock}`.slice(0,100),value:String(i)}))))];
}
function ticketControls(){
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('payment_info').setLabel('Payment Info').setEmoji('💳').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('paid_submit').setLabel('I Have Paid').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger)
  )];
}
async function log(guild, message, embed){
  if(!LOG_CHANNEL_ID) return;
  const ch = await guild.channels.fetch(LOG_CHANNEL_ID).catch(()=>null);
  if(ch?.isTextBased()) await ch.send({content:message||undefined,embeds:embed?[embed]:[]}).catch(()=>{});
}
async function createTicket(interaction){
  const guild=interaction.guild;
  const existing=guild.channels.cache.find(c=>c.type===ChannelType.GuildText && c.topic?.includes(`ticket-owner:${interaction.user.id}`));
  if(existing) return interaction.reply({content:`You already have an open ticket: ${existing}`,ephemeral:true});
  const overwrites=[
    {id:guild.roles.everyone.id,deny:[PermissionFlagsBits.ViewChannel]},
    {id:interaction.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.AttachFiles]},
    {id:client.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels]}
  ];
  if(SUPPORT_ROLE_ID) overwrites.push({id:SUPPORT_ROLE_ID,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]});
  const clean=interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g,'-').replace(/-+/g,'-').slice(0,30)||'customer';
  const channel=await guild.channels.create({name:`ticket-${clean}-${interaction.user.id.slice(-4)}`,type:ChannelType.GuildText,
    topic:`Purchase ticket | ticket-owner:${interaction.user.id}`,parent:TICKET_CATEGORY_ID||undefined,permissionOverwrites:overwrites});
  await channel.send({content:`${interaction.user} ${SUPPORT_ROLE_ID?`<@&${SUPPORT_ROLE_ID}>`:'Store staff'}`,
    embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('🎫 Purchase Ticket')
      .setDescription('Choose your product below. Staff will confirm the final price, availability and payment details.').setFooter({text:STORE_NAME})],
    components:productMenu().concat(ticketControls())});
  await interaction.reply({content:`Your private ticket is ready: ${channel}`,ephemeral:true});
}
async function showPayment(interaction){
  const lines=[];
  if(ESEWA_ID) lines.push(`**eSewa:** ${ESEWA_ID}`);
  if(KHALTI_ID) lines.push(`**Khalti:** ${KHALTI_ID}`);
  if(FONEPAY_INFO) lines.push(`**Fonepay:** ${FONEPAY_INFO}`);
  if(!lines.length) lines.push('Payment details have not been configured. Please wait for staff.');
  return interaction.reply({embeds:[new EmbedBuilder().setColor(0x5865F2).setTitle('💳 Payment Instructions')
    .setDescription(lines.join('\n')+'\n\n'+PAYMENT_NOTE+'\n\nAfter payment, submit your transaction reference using **I Have Paid**. Staff must verify it manually.')],ephemeral:true});
}
async function closeTicket(interaction){
  const ch=interaction.channel;
  if(!ch?.topic?.includes('ticket-owner:')) return interaction.reply({content:'Use this inside a purchase ticket.',ephemeral:true});
  const owner=ch.topic.match(/ticket-owner:(\d+)/)?.[1];
  if(interaction.user.id!==owner&&!staff(interaction)) return interaction.reply({content:'Only the ticket owner or staff can close this ticket.',ephemeral:true});
  const order=ticketOrder(ch.id); if(order){order.status='closed';saveOrders();}
  await interaction.reply({content:'🔒 Ticket closed. Channel will be deleted in 10 seconds.'});
  setTimeout(()=>ch.delete('Ticket closed').catch(()=>{}),10000);
}
client.once(Events.ClientReady, c=>console.log(`Online as ${c.user.tag}`));
client.on(Events.InteractionCreate, async i=>{
 try{
  if(i.isChatInputCommand()){
   const ch=i.channel;
   if(i.commandName==='setup-panel'){await ch.send({embeds:[productEmbed()],components:panelRows()});return i.reply({content:'Store panel posted.',ephemeral:true});}
   if(i.commandName==='close-ticket') return closeTicket(i);
   if(i.commandName==='payment-info') return showPayment(i);
   if(i.commandName==='mark-paid'){
    if(!staff(i)) return i.reply({content:'Staff only.',ephemeral:true});
    const o=ticketOrder(ch.id);if(!o)return i.reply({content:'No active order in this ticket.',ephemeral:true});
    o.status='paid';o.paidAt=new Date().toISOString();saveOrders();
    await log(i.guild,`Payment marked paid: ${o.id} · ${o.product} · ${o.userId}`);
    return i.reply({content:`✅ Order ${o.id} marked as paid. Staff can now use /deliver.`});
   }
   if(i.commandName==='deliver'){
    if(!staff(i))return i.reply({content:'Staff only.',ephemeral:true});
    const o=ticketOrder(ch.id);if(!o)return i.reply({content:'No active order in this ticket.',ephemeral:true});
    if(o.status!=='paid')return i.reply({content:'Mark payment as paid first with /mark-paid.',ephemeral:true});
    const details=i.options.getString('details');
    const member=await i.guild.members.fetch(o.userId).catch(()=>null);
    await ch.send({content:`🎉 **Order delivered to ${member||`<@${o.userId}>`}**\n${details}\n\nPlease confirm receipt. Never share passwords or OTPs.`});
    o.status='delivered';o.deliveredAt=new Date().toISOString();saveOrders();
    await log(i.guild,`Delivered: ${o.id} · ${o.product} · ${o.userId}`);
    return i.reply({content:`Delivery recorded for order ${o.id}.`,ephemeral:true});
   }
   if(i.commandName==='set-stock'||i.commandName==='set-price'){
    if(!staff(i))return i.reply({content:'Staff only.',ephemeral:true});
    const name=i.options.getString('product');const p=products.find(x=>x.name.toLowerCase()===name.toLowerCase());
    if(!p)return i.reply({content:'Product not found. Use the exact product name.',ephemeral:true});
    if(i.commandName==='set-stock')p.stock=i.options.getString('stock');else p.price=i.options.getString('price');
    saveProducts();return i.reply({content:`Updated **${p.name}**. Repost the panel with /setup-panel to show changes.`,ephemeral:true});
   }
   if(i.commandName==='add-product'){
    if(!staff(i))return i.reply({content:'Staff only.',ephemeral:true});
    if(products.length>=25)return i.reply({content:'Maximum 25 products supported in the selection menu.',ephemeral:true});
    const name=i.options.getString('name');if(products.some(p=>p.name.toLowerCase()===name.toLowerCase()))return i.reply({content:'That product already exists.',ephemeral:true});
    products.push({name,price:i.options.getString('price'),stock:i.options.getString('stock')});saveProducts();
    return i.reply({content:`Added **${name}**. Repost panel with /setup-panel.`,ephemeral:true});
   }
   if(i.commandName==='order-status'){
    if(!staff(i))return i.reply({content:'Staff only.',ephemeral:true});
    const o=ticketOrder(ch.id);return i.reply({content:o?`Order **${o.id}** · **${o.product}** · Status: **${o.status}** · Customer: <@${o.userId}>`:'No active order in this ticket.',ephemeral:true});
   }
   if(i.commandName==='review'){
    const o=orders.find(x=>x.userId===i.user.id&&x.status==='delivered');
    if(!o)return i.reply({content:'You can review after a delivered order.',ephemeral:true});
    const rating=i.options.getInteger('rating'),comment=i.options.getString('comment')||'No comment';
    reviews.push({userId:i.user.id,rating,comment,createdAt:new Date().toISOString()});writeJson(REVIEWS_FILE,reviews);
    await log(i.guild,`⭐ Review ${rating}/5 from ${i.user.tag}: ${comment}`);
    return i.reply({content:'Thank you for your review!',ephemeral:true});
   }
   if(i.commandName==='warranty'){
    const details=i.options.getString('details');
    await log(i.guild,`Warranty request from ${i.user.tag}: ${details}`);
    return i.reply({content:'Warranty request recorded. Please open a purchase ticket and share your order details with staff.',ephemeral:true});
   }
  }
  if(i.isButton()){
   if(i.customId==='buy_now')return createTicket(i);
   if(i.customId==='view_stock')return i.reply({embeds:[new EmbedBuilder().setColor(0x5865F2).setTitle('📦 Stock').setDescription(products.map(p=>`**${p.name}** — ${p.stock}`).join('\n')||'No products').setFooter({text:'Confirm availability with staff before paying.'})],ephemeral:true});
   if(i.customId==='payment_info')return showPayment(i);
   if(i.customId==='close_ticket')return closeTicket(i);
   if(i.customId==='paid_submit'){
    const modal=new ModalBuilder().setCustomId('payment_reference').setTitle('Submit payment reference');
    const input=new TextInputBuilder().setCustomId('reference').setLabel('Transaction ID / reference').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100);
    modal.addComponents(new ActionRowBuilder().addComponents(input));return i.showModal(modal);
   }
  }
  if(i.isModalSubmit()&&i.customId==='payment_reference'){
   const o=ticketOrder(i.channel.id);if(!o)return i.reply({content:'Select a product first, then submit payment.',ephemeral:true});
   if(o.userId!==i.user.id)return i.reply({content:'Only the ticket owner can submit payment reference.',ephemeral:true});
   o.paymentReference=i.fields.getTextInputValue('reference');o.status='payment-submitted';o.paymentSubmittedAt=new Date().toISOString();saveOrders();
   await log(i.guild,`Payment reference submitted for ${o.id} by ${i.user.tag}: ${o.paymentReference}`);
   return i.reply({content:'Payment reference submitted. Staff will verify it manually. Do not send passwords or OTPs.',ephemeral:true});
  }
  if(i.isStringSelectMenu()&&i.customId==='choose_product'){
   const owner=i.channel.topic?.match(/ticket-owner:(\d+)/)?.[1];
   if(owner!==i.user.id&&!staff(i))return i.reply({content:'Only ticket owner or staff can select a product.',ephemeral:true});
   const p=products[Number(i.values[0])];if(!p)return i.reply({content:'Product not found.',ephemeral:true});
   const order={id:`ORD-${Date.now().toString(36).toUpperCase()}`,channelId:i.channel.id,userId:owner,product:p.name,price:p.price,status:'pending',createdAt:new Date().toISOString()};
   orders=orders.filter(x=>x.channelId!==i.channel.id||x.status==='closed');orders.push(order);saveOrders();
   await log(i.guild,`New order ${order.id}: ${p.name} · ${p.price} · ${owner}`);
   return i.reply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('🧾 Order created').setDescription(`Order ID: **${order.id}**\nProduct: **${p.name}**\nPrice: **${p.price}**\nStock: **${p.stock}**\nStatus: **Pending staff confirmation**\n\nUse **Payment Info** after staff confirms the order.`)]});
  }
 }catch(e){console.error(e);if(i.isRepliable()){const msg='Something went wrong. Check hosting logs and bot permissions.';if(i.deferred||i.replied)await i.followUp({content:msg,ephemeral:true}).catch(()=>{});else await i.reply({content:msg,ephemeral:true}).catch(()=>{});}}
});
const rest=new REST({version:'10'}).setToken(DISCORD_TOKEN);
await rest.put(Routes.applicationGuildCommands(CLIENT_ID,GUILD_ID),{body:commands});
console.log('Slash commands registered.');
client.login(DISCORD_TOKEN);
