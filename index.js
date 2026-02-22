require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  EmbedBuilder,
} = require("discord.js");

const fs = require("fs");
const cron = require("node-cron");

// =============================
// 🔐 ENV
// =============================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

// =============================
// 🤖 CLIENT
// =============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once("ready", () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
});

// =============================
// 📦 DATA
// =============================
const DATA_FILE = "./data.json";

function startOfWeekSundayISO(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = dimanche
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0); // dimanche 00:00
  return d.toISOString();
}

function formatMoney(n) {
  const num = Number(n) || 0;
  // Affichage simple: 1500$ (avec séparateurs)
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(num)}$`;
}

function formatWeekStart(weekStartISO) {
  try {
    const d = new Date(weekStartISO);
    return d.toLocaleDateString("fr-FR", { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return "";
  }
}

function buildVenteEmbed({ user, total, weekStartISO, objectif }) {
  const amount = Number(total) || 0;
  const goal = Number(objectif) || 0;

  const embed = new EmbedBuilder()
    .setTitle("Ventes hebdomadaires")
    .setColor(0x34495e)
    .addFields(
      { name: "Employé", value: `${user}`, inline: true },
      { name: "Total semaine", value: `**${formatMoney(amount)}**`, inline: true },
    );

  if (goal > 0) {
    const pct = Math.round((amount / goal) * 100);
    const remaining = goal - amount;

    embed.addFields({ name: "Objectif", value: `**${formatMoney(goal)}**`, inline: true });

    const bar = progressBar(amount, goal, 14);
    const status =
      remaining > 0
        ? `Reste : **${formatMoney(remaining)}**`
        : `Dépassement : **${formatMoney(Math.abs(remaining))}**`;

    embed.addFields({
      name: "Progression",
      value: `${bar}  **${pct}%**
${status}`,
      inline: false,
    });
  }

  const ws = formatWeekStart(weekStartISO);
  embed.setFooter({ text: ws ? `Semaine du ${ws}` : "Semaine en cours" });

  return embed;
}


function defaultData() {
  return {
    weekStartISO: startOfWeekSundayISO(new Date()),
    quotas: {},
    ventes: {},
    vente_objectif: 0,
    objectifs: {
      cheeseburger: 30,
      sandwich_poulet: 30,
      wrap_poulet: 30,
      salade_poulet: 30,
      burger_vegan: 30,
      cheese_fish: 30,
      nuggets: 30,
      frites: 200,
      jus_orange: 65,
      ecola: 65,
      sprunk: 65,
      cafe: 0,
    },
  };
}

let data = defaultData();

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ✅ PATCH: loadData “robuste” (supporte les anciens data.json)
function loadData() {
  const defaults = defaultData();

  if (fs.existsSync(DATA_FILE)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

      // Ancien format possible: data.json = { "userId": { "type": n } }
      const maybeOldQuotasOnly =
        loaded &&
        typeof loaded === "object" &&
        !Array.isArray(loaded) &&
        loaded.quotas === undefined &&
        loaded.objectifs === undefined &&
        loaded.weekStartISO === undefined;

      const normalizedQuotas = maybeOldQuotasOnly ? loaded : (loaded.quotas ?? {});

      data = {
        ...defaults,
        ...loaded,
        quotas: normalizedQuotas,
        ventes: loaded.ventes ?? {},
        vente_objectif: typeof loaded.vente_objectif === 'number' ? loaded.vente_objectif : 0,
        objectifs: { ...defaults.objectifs, ...(loaded.objectifs || {}) },
        weekStartISO: loaded.weekStartISO || defaults.weekStartISO,
      };

      // Normalise le fichier pour éviter les crashs futurs
      saveData();
    } catch (e) {
      console.error("❌ data.json illisible, reset vers default.", e);
      data = defaults;
      saveData();
    }
  } else {
    data = defaults;
    saveData();
  }
}

function resetWeekly() {
  data.weekStartISO = startOfWeekSundayISO(new Date());
  data.quotas = {};
  data.ventes = {};
  saveData();
  console.log("🔁 Reset hebdomadaire effectué !");
}

function ensureWeeklyReset() {
  const current = startOfWeekSundayISO(new Date());
  if (data.weekStartISO !== current) {
    resetWeekly();
  }
}

loadData();

// Reset automatique dimanche 00:01
cron.schedule(
  "0 0 * * 0",
  () => {
    resetWeekly();
  },
  { timezone: "Europe/Paris" }
);

// =============================
// 🛠 COMMANDES
// =============================

const PRODUCT_CHOICES = [
  // Burgers
  { name: "Cheeseburger", value: "cheeseburger" },
  { name: "Burger Vegan", value: "burger_vegan" },
  { name: "Cheese Fish", value: "cheese_fish" },

  // Poulet
  { name: "Sandwich Poulet", value: "sandwich_poulet" },
  { name: "Wrap Poulet", value: "wrap_poulet" },
  { name: "Salade Poulet", value: "salade_poulet" },

  // Snacks
  { name: "Nuggets", value: "nuggets" },
  { name: "Frites", value: "frites" },

  // Boissons
  { name: "Ecola", value: "ecola" },
  { name: "Sprunk", value: "sprunk" },
  { name: "Jus Orange", value: "jus_orange" },

  // Extras
  { name: "Café", value: "cafe" },
];

// Pour un affichage propre dans les embeds (nom + catégorie)
const PRODUCT_META = {
  cheeseburger: { label: "Cheeseburger", cat: "🍔 Burgers" },
  burger_vegan: { label: "Burger Vegan", cat: "🍔 Burgers" },
  cheese_fish: { label: "Cheese Fish", cat: "🍔 Burgers" },

  sandwich_poulet: { label: "Sandwich Poulet", cat: "🍗 Poulet" },
  wrap_poulet: { label: "Wrap Poulet", cat: "🍗 Poulet" },
  salade_poulet: { label: "Salade Poulet", cat: "🍗 Poulet" },

  nuggets: { label: "Nuggets", cat: "🍟 Snacks" },
  frites: { label: "Frites", cat: "🍟 Snacks" },

  ecola: { label: "Ecola", cat: "🥤 Boissons" },
  sprunk: { label: "Sprunk", cat: "🥤 Boissons" },
  jus_orange: { label: "Jus Orange", cat: "🥤 Boissons" },

  cafe: { label: "Café", cat: "☕ Extras" },
};

function progressBar(done, total, size = 12) {
  const t = Math.max(1, Number(total) || 1);
  const d = Math.max(0, Number(done) || 0);
  const ratio = Math.min(1, d / t);
  const filled = Math.round(ratio * size);
  return "▰".repeat(filled) + "▱".repeat(size - filled);
}

function pickColor(percent) {
  if (percent >= 100) return 0x2ecc71; // vert
  if (percent >= 50) return 0xf1c40f; // jaune
  return 0xe74c3c; // rouge
}

function buildObjectifsEmbed(objectifs) {
  const grouped = new Map(); // cat -> lines[]

  for (const [typeId, goal] of Object.entries(objectifs || {})) {
    const g = Number(goal) || 0;

    // On garde "cafe" si défini, mais on évite d'afficher les objectifs à 0
    if (g <= 0) continue;

    const meta = PRODUCT_META[typeId] ?? { label: typeId, cat: "📦 Autres" };
    if (!grouped.has(meta.cat)) grouped.set(meta.cat, []);
    grouped.get(meta.cat).push(`• **${meta.label}** : \`${g}\``);
  }

  const embed = new EmbedBuilder()
    .setTitle("🎯 Objectifs hebdomadaires")
    .setDescription("Voici les objectifs à atteindre cette semaine :")
    .setColor(0xf1c40f)
    .setFooter({
      text: `Aujourd'hui à ${new Date().toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
      })}`,
    });

  for (const [cat, lines] of grouped.entries()) {
    embed.addFields({ name: cat, value: lines.join("\n"), inline: false });
  }

  if (grouped.size === 0) {
    embed.setDescription("Aucun objectif défini.");
  }

  return embed;
}

const commands = [
  new SlashCommandBuilder()
    .setName("quota-add")
    .setDescription("Ajouter un quota")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((option) =>
      option.setName("membre").setDescription("Membre").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("Produit")
        .setRequired(true)
        .addChoices(...PRODUCT_CHOICES)
    )
    .addIntegerOption((option) =>
      option.setName("quantite").setDescription("Quantité").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("quota-view")
    .setDescription("Voir les quotas d’un membre")
    .addUserOption((option) =>
      option.setName("membre").setDescription("Membre").setRequired(true)
    )
    .addBooleanOption((option) =>
      option
        .setName("tout")
        .setDescription("Afficher aussi les produits déjà terminés")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("quota-remove")
    .setDescription("Retirer un quota")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((option) =>
      option.setName("membre").setDescription("Membre").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("Produit")
        .setRequired(true)
        .addChoices(...PRODUCT_CHOICES)
    )
    .addIntegerOption((option) =>
      option.setName("quantite").setDescription("Quantité").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("objectif-set")
    .setDescription("Définir un objectif")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("Produit")
        .setRequired(true)
        .addChoices(...PRODUCT_CHOICES)
    )
    .addIntegerOption((option) =>
      option.setName("quantite").setDescription("Objectif").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("objectif-view")
    .setDescription("Voir les objectifs"),


// =============================
// 💰 VENTES
// =============================
new SlashCommandBuilder()
  .setName("vente-add")
  .setDescription("Ajouter une vente à ton total (semaine)")
  .addNumberOption((option) =>
    option
      .setName("montant")
      .setDescription("Montant de la vente")
      .setRequired(true)
      .setMinValue(0)
  )
  .addUserOption((option) =>
    option
      .setName("membre")
      .setDescription("Membre (optionnel, Admin)")
      .setRequired(false)
  ),

new SlashCommandBuilder()
  .setName("vente-my")
  .setDescription("Afficher ton total de ventes (semaine)"),

new SlashCommandBuilder()
  .setName("vente-view")
  .setDescription("Voir les ventes d’un membre (Admin)")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((option) =>
    option.setName("membre").setDescription("Membre").setRequired(true)
  ),

new SlashCommandBuilder()
  .setName("vente-objectif-set")
  .setDescription("Définir l’objectif de ventes hebdomadaire (Admin)")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addNumberOption((option) =>
    option
      .setName("montant")
      .setDescription("Objectif hebdomadaire")
      .setRequired(true)
      .setMinValue(0)
  ),

new SlashCommandBuilder()
  .setName("vente-remove")
  .setDescription("Retirer un montant de ventes (Admin)")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((option) =>
    option.setName("membre").setDescription("Membre").setRequired(true)
  )
  .addNumberOption((option) =>
    option
      .setName("montant")
      .setDescription("Montant à retirer")
      .setRequired(true)
      .setMinValue(0)
  ),

new SlashCommandBuilder()
  .setName("vente-leaderboard")
  .setDescription("Top 10 ventes de la semaine"),



  // ✅ NOUVEAU : qui a terminé ses quotas
  new SlashCommandBuilder()
    .setName("quota-leaderboard")
    .setDescription("Voir quels employés ont terminé leurs quotas (selon objectifs)"),
].map((command) => command.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: commands,
  });
  console.log("✅ Commandes enregistrées");
})();

// =============================
// 🎮 INTERACTIONS
// =============================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    ensureWeeklyReset();

    // ---------- quota-add ----------
    if (interaction.commandName === "quota-add") {
      const user = interaction.options.getUser("membre");
      const type = interaction.options.getString("type");
      const quantite = interaction.options.getInteger("quantite");

      if (!data.quotas[user.id]) data.quotas[user.id] = {};
      if (!data.quotas[user.id][type]) data.quotas[user.id][type] = 0;

      data.quotas[user.id][type] += quantite;
      saveData();

      return interaction.reply(`✅ ${quantite} ajouté à ${user}`);
    }

    // ---------- quota-view ----------
    if (interaction.commandName === "quota-view") {
      const user = interaction.options.getUser("membre");
      const showAll = interaction.options.getBoolean("tout") ?? false;

      if (!data.quotas[user.id] || Object.keys(data.quotas[user.id]).length === 0) {
        return interaction.reply("Aucun quota trouvé.");
      }

      const objectifs = data.objectifs || {};
      const quotasUser = data.quotas[user.id] || {};

      // Prépare les lignes et un résumé global
      const allItems = Object.entries(quotasUser)
        .map(([typeId, current]) => {
          const goal = objectifs?.[typeId] ?? 0;
          const c = Number(current) || 0;
          const g = Number(goal) || 0;
          const percent = g > 0 ? Math.round((c / g) * 100) : 0;
          const meta = PRODUCT_META[typeId] ?? { label: typeId, cat: "📦 Autres" };
          return { typeId, c, g, percent, meta };
        })
        // Ne garde que ceux qui ont un objectif défini (>0) pour éviter les % bizarres
        .filter((x) => x.g > 0)
        // Tri: ceux les plus en retard d'abord
        .sort((a, b) => a.percent - b.percent);

      const items = showAll ? allItems : allItems.filter((x) => x.percent < 100);

      if (items.length === 0) {
        return interaction.reply(
          showAll
            ? "Aucun quota avec objectif défini (objectif = 0). Utilise /objectif-set."
            : "✅ Tous les quotas sont terminés ! (Utilise **/quota-view tout:true** pour tout afficher.)"
        );
      }

      // Progression globale calculée sur tous les items (même si on masque les terminés)
      const totalDone = allItems.reduce((s, x) => s + x.c, 0);
      const totalGoal = allItems.reduce((s, x) => s + x.g, 0);
      const globalPercent = totalGoal > 0 ? Math.round((totalDone / totalGoal) * 100) : 0;

      // Regroupement par catégories
      const grouped = new Map(); // cat -> [{...}]
      for (const it of items) {
        const cat = it.meta.cat;
        if (!grouped.has(cat)) grouped.set(cat, []);
        grouped.get(cat).push(it);
      }

      const embed = new EmbedBuilder()
        .setColor(pickColor(globalPercent))
        .setTitle(`📊 Quotas de ${user.username}`)
        .setDescription(
          `Progression globale : **${globalPercent}%**  (\`${totalDone}/${totalGoal}\`)\n` +
            `${progressBar(totalDone, totalGoal, 14)}\n` +
            `\n📌 Astuce : on affiche en haut ce qui est le plus **urgent**.`
        )
        .setTimestamp();

      // Ajoute les catégories (1 field par catégorie)
      for (const [cat, arr] of grouped.entries()) {
        // Tri interne: urgent -> terminé
        arr.sort((a, b) => a.percent - b.percent);

        const lines = arr.map((x) => {
          const bar = progressBar(x.c, x.g, 10);
          const over = x.c - x.g;
          const status = x.percent >= 100 ? "✅" : x.percent >= 50 ? "🟡" : "🔴";
          const overTxt = over > 0 ? `  **(+${over})**` : "";
          return `${status} **${x.meta.label}** — \`${x.c}/${x.g}\` (**${x.percent}%**)\n${bar}${overTxt}`;
        });

        // Discord: 1024 caractères max par field.value → on tronque si besoin
        let value = lines.join("\n");
        if (value.length > 1024) value = value.slice(0, 1021) + "…";

        embed.addFields({ name: cat, value, inline: false });
      }

      embed.setFooter({
        text: `Semaine commencée le ${new Date(data.weekStartISO).toLocaleDateString("fr-FR")}`,
      });

      return interaction.reply({ embeds: [embed] });
    }

    // ---------- quota-remove ----------
    if (interaction.commandName === "quota-remove") {
      const user = interaction.options.getUser("membre");
      const type = interaction.options.getString("type");
      const quantite = interaction.options.getInteger("quantite");

      if (!data.quotas[user.id] || !data.quotas[user.id][type]) {
        return interaction.reply("Ce quota n'existe pas.");
      }

      data.quotas[user.id][type] -= quantite;
      if (data.quotas[user.id][type] < 0) data.quotas[user.id][type] = 0;

      saveData();
      return interaction.reply(`❌ ${quantite} retiré à ${user}`);
    }

    // ---------- objectif-set ----------
    if (interaction.commandName === "objectif-set") {
      const type = interaction.options.getString("type");
      const quantite = interaction.options.getInteger("quantite");

      if (!data.objectifs) data.objectifs = {};
      data.objectifs[type] = quantite;
      saveData();

      return interaction.reply(`🎯 Objectif ${type} défini à ${quantite}`);
    }

    // ---------- objectif-view ----------
    if (interaction.commandName === "objectif-view") {
      const embed = buildObjectifsEmbed(data.objectifs);
      return interaction.reply({ embeds: [embed] });
    }


// ---------- vente-add ----------
if (interaction.commandName === "vente-add") {
  const montant = interaction.options.getNumber("montant", true);
  const membre = interaction.options.getUser("membre", false);

  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

  // Si on cible quelqu’un d’autre, il faut être admin
  if (membre && membre.id !== interaction.user.id && !isAdmin) {
    return interaction.reply({ content: "⛔ Seul un Admin peut ajouter une vente pour un autre membre.", ephemeral: true });
  }

  const targetUser = membre ?? interaction.user;
  const targetId = targetUser.id;

  if (!data.ventes) data.ventes = {};
  if (!data.ventes[targetId]) data.ventes[targetId] = 0;

  data.ventes[targetId] += montant;
  saveData();

  const embed = buildVenteEmbed({
    user: targetUser,
    total: data.ventes[targetId],
    weekStartISO: data.weekStartISO,
    objectif: data.vente_objectif,
  }).setDescription(`Ajout enregistré : **${formatMoney(montant)}**`);

  return interaction.reply({ embeds: [embed] });
}

// ---------- vente-my ----------
if (interaction.commandName === "vente-my") {
  const total = data.ventes?.[interaction.user.id] ?? 0;
  return interaction.reply({ embeds: [buildVenteEmbed({ user: interaction.user, total, weekStartISO: data.weekStartISO, objectif: data.vente_objectif })] });
}

// ---------- vente-view ----------
if (interaction.commandName === "vente-view") {
  // double-check perms (au cas où)
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
  if (!isAdmin) {
    return interaction.reply({ content: "⛔ Commande réservée Admin.", ephemeral: true });
  }

  const membre = interaction.options.getUser("membre", true);
  const total = data.ventes?.[membre.id] ?? 0;

  return interaction.reply({ embeds: [buildVenteEmbed({ user: membre, total, weekStartISO: data.weekStartISO, objectif: data.vente_objectif })] });
}

// ---------- vente-objectif-set ----------
if (interaction.commandName === "vente-objectif-set") {
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
  if (!isAdmin) {
    return interaction.reply({ content: "⛔ Commande réservée Admin.", ephemeral: true });
  }

  const montant = interaction.options.getNumber("montant", true);
  data.vente_objectif = montant;
  saveData();

  const embed = new EmbedBuilder()
    .setTitle("Objectif de ventes mis à jour")
    .setDescription(`Objectif hebdomadaire : **${formatMoney(montant)}**`)
    .setFooter({ text: `Semaine du ${new Date(data.weekStartISO).toLocaleDateString("fr-FR")}` })
    .setTimestamp();

  return interaction.reply({ embeds: [embed] });
}

// ---------- vente-remove ----------
if (interaction.commandName === "vente-remove") {
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
  if (!isAdmin) {
    return interaction.reply({ content: "⛔ Commande réservée Admin.", ephemeral: true });
  }

  const membre = interaction.options.getUser("membre", true);
  const montant = interaction.options.getNumber("montant", true);

  if (!data.ventes) data.ventes = {};
  if (!data.ventes[membre.id]) data.ventes[membre.id] = 0;

  data.ventes[membre.id] -= montant;
  if (data.ventes[membre.id] < 0) data.ventes[membre.id] = 0;

  saveData();

  return interaction.reply(
    `✅ Correction: -**${formatMoney(montant)}** pour ${membre} — Nouveau total: **${formatMoney(data.ventes[membre.id])}**`
  );
}

// ---------- vente-leaderboard ----------
if (interaction.commandName === "vente-leaderboard") {
  const rows = Object.entries(data.ventes || {})
    .map(([userId, total]) => ({ userId, total: Number(total) || 0 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  if (rows.length === 0) {
    return interaction.reply("Aucune vente enregistrée cette semaine.");
  }

  const embed = new EmbedBuilder()
    .setColor("Purple")
    .setTitle("🏆 Top 10 ventes — Semaine")
    .setDescription(`Ajoute une vente avec **/vente-add**\nReset : dimanche **00:00**`)
    .setFooter({ text: `Semaine commencée le ${new Date(data.weekStartISO).toLocaleDateString("fr-FR")}` })
    .setTimestamp();

  rows.forEach((r, idx) => {
    embed.addFields({
      name: `${idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx + 1}`} — <@${r.userId}>`,
      value: `**${formatMoney(r.total)}**`,
      inline: false,
    });
  });

  return interaction.reply({ embeds: [embed] });
}



    // ---------- quota-leaderboard ----------
    if (interaction.commandName === "quota-leaderboard") {
      const objectifs = data.objectifs || {};
      const objectiveKeys = Object.keys(objectifs).filter((k) => (objectifs[k] ?? 0) > 0);

      if (objectiveKeys.length === 0) {
        return interaction.reply("Aucun objectif > 0 n'est défini. Utilise /objectif-set.");
      }

      if (!data.quotas || Object.keys(data.quotas).length === 0) {
        return interaction.reply("Aucun quota enregistré cette semaine.");
      }

      const totalObjectif = objectiveKeys.reduce((sum, k) => sum + (objectifs[k] ?? 0), 0);

      const rows = Object.entries(data.quotas).map(([userId, userQuotas]) => {
        let totalUser = 0;
        let finishedAll = true;

        for (const k of objectiveKeys) {
          const obj = objectifs[k] ?? 0;
          const val = userQuotas?.[k] ?? 0;
          totalUser += val;

          if (val < obj) finishedAll = false;
        }

        const percent = totalObjectif > 0 ? Math.round((totalUser / totalObjectif) * 100) : 0;

        return { userId, totalUser, percent, finishedAll };
      });

      // Tri: terminés d'abord, puis % décroissant
      rows.sort((a, b) => {
        if (a.finishedAll !== b.finishedAll) return a.finishedAll ? -1 : 1;
        return b.percent - a.percent;
      });

      const embed = new EmbedBuilder()
        .setColor("Green")
        .setTitle("📊 Quotas hebdomadaires — Qui a terminé ?")
        .setDescription(`Reset : dimanche **00:01** — Objectif total (somme objectifs > 0) : **${totalObjectif}**`)
        .setTimestamp();

      // Affiche max 25 champs pour éviter limite Discord
      const max = Math.min(rows.length, 25);

      for (let i = 0; i < max; i++) {
        const r = rows[i];
        const status = r.finishedAll ? "✅ Terminé" : "⏳ En cours";

        embed.addFields({
          name: `<@${r.userId}> — ${status}`,
          value: `${r.totalUser}/${totalObjectif} (**${r.percent}%**)`,
          inline: false,
        });
      }

      // Petit rappel si ça dépasse 25
      if (rows.length > 25) {
        embed.setFooter({ text: `Affichage limité à 25 employés (sur ${rows.length}).` });
      }

      return interaction.reply({ embeds: [embed] });
    }
  } catch (err) {
    console.error("❌ Erreur interaction:", err);
    if (interaction.deferred || interaction.replied) {
      return interaction.followUp({ content: "❌ Erreur interne (voir logs).", ephemeral: true });
    }
    return interaction.reply({ content: "❌ Erreur interne (voir logs).", ephemeral: true });
  }
});

// =============================
// 🚀 LOGIN (UNE SEULE FOIS)
// =============================
client.login(TOKEN);