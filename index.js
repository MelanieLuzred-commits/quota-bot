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

// 🔐 Variables d'environnement
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

// ✅ Création du client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// =========================
// 📦 DATA (quotas + objectifs)
// =========================

const DATA_FILE = "./data.json";

/**
 * Structure data.json:
 * {
 *   "weekStartISO": "...",
 *   "quotas": { "userId": { "type": number } },
 *   "objectifs": { "type": number }
 * }
 */

function startOfWeekISO_Sunday(d) {
  // Ici on considère la "semaine" qui démarre le dimanche 00:01 (pour coller à ton reset)
  // On stocke juste un marqueur ISO du "dimanche de référence".
  const date = new Date(d);
  const day = date.getDay(); // 0=dimanche
  const diffToSunday = -day; // ramène au dimanche
  date.setDate(date.getDate() + diffToSunday);
  date.setHours(0, 1, 0, 0); // dimanche 00:01
  return date.toISOString();
}

function defaultData() {
  return {
    weekStartISO: startOfWeekISO_Sunday(new Date()),
    quotas: {},
    objectifs: {
      // Mets tes objectifs par défaut ici (tu peux modifier via commande)
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
  };++
}

let data = defaultData();

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    } catch (e) {
      console.error("❌ data.json illisible, reset vers default.", e);
      data = defaultData();
      saveData();
    }
  } else {
    data = defaultData();
    saveData();
  }
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Reset quotas (garde les objectifs)
function resetWeeklyQuotas() {
  data.weekStartISO = startOfWeekISO_Sunday(new Date());
  data.quotas = {};
  saveData();
  console.log("🔁 Reset hebdomadaire effectué (dimanche 00:01).");
}

// Sécurité : si Render/redémarrage a “raté” le dimanche, on reset quand même
function ensureWeeklyReset() {
  const currentWeek = startOfWeekISO_Sunday(new Date());
  if (data.weekStartISO !== currentWeek) {
    resetWeeklyQuotas();
    return true;
  }
  return false;
}

function getUserQuota(userId, type) {
  if (!data.quotas[userId]) data.quotas[userId] = {};
  if (!data.quotas[userId][type]) data.quotas[userId][type] = 0;
  return data.quotas[userId][type];
}

function setUserQuota(userId, type, value) {
  if (!data.quotas[userId]) data.quotas[userId] = {};
  data.quotas[userId][type] = value;
}

function getObjectif(type) {
  return data.objectifs?.[type] ?? null;
}

// Charger data au boot
loadData();

// ✅ Reset automatique tous les DIMANCHES à 00:01 (heure de Paris)
cron.schedule(
  "1 0 * * 0", // min=1, hour=0, dayOfWeek=0 (dimanche)
  () => {
    resetWeeklyQuotas();
  },
  { timezone: "Europe/Paris" }
);

// =========================
// ✅ Event ready
// =========================
client.once("ready", () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
});

// =========================
// 🔧 Commandes
// =========================
const commands = [
  new SlashCommandBuilder()
    .setName("quota-add")
    .setDescription("Ajouter un quota à un membre")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((option) =>
      option.setName("membre").setDescription("Membre").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("type").setDescription("Type (ex: menu)").setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName("quantite").setDescription("Quantité").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("quota-view")
    .setDescription("Voir les quotas d’un membre + progression objectif")
    .addUserOption((option) =>
      option.setName("membre").setDescription("Membre").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("quota-remove")
    .setDescription("Retirer un quota à un membre")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((option) =>
      option.setName("membre").setDescription("Membre").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("type").setDescription("Type").setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName("quantite").setDescription("Quantité").setRequired(true)
    ),

  // ✅ NOUVEAU : définir un objectif
  new SlashCommandBuilder()
    .setName("objectif-set")
    .setDescription("Définir / modifier un objectif (par type)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("Type (ex: menu, cheeseburger, frites...)")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName("quantite").setDescription("Objectif").setRequired(true)
    ),

  // ✅ NOUVEAU : voir tous les objectifs
  new SlashCommandBuilder()
    .setName("objectif-view")
    .setDescription("Voir les objectifs actuels"),
].map((command) => command.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: commands,
  });
  console.log("✅ Commandes enregistrées");
})();

// =========================
// 🎛️ Interactions
// =========================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // sécurité reset hebdo
  ensureWeeklyReset();

  // ---------- quota-add ----------
  if (interaction.commandName === "quota-add") {
    const user = interaction.options.getUser("membre");
    const type = interaction.options.getString("type");
    const quantite = interaction.options.getInteger("quantite");

    const current = getUserQuota(user.id, type);
    setUserQuota(user.id, type, current + quantite);
    saveData();

    const embed = new EmbedBuilder()
      .setColor("Green")
      .setTitle("Quota ajouté")
      .setDescription(`✅ ${quantite} quotas ajoutés à ${user}`)
      .addFields(
        { name: "Type", value: type, inline: true },
        {
          name: "Total",
          value: data.quotas[user.id][type].toString(),
          inline: true,
        }
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // ---------- quota-view ----------
  if (interaction.commandName === "quota-view") {
    const user = interaction.options.getUser("membre");

    if (!data.quotas[user.id] || Object.keys(data.quotas[user.id]).length === 0) {
      return interaction.reply("Aucun quota trouvé.");
    }

    const embed = new EmbedBuilder()
      .setColor("Blue")
      .setTitle(`Quotas de ${user.username} (semaine en cours)`)
      .setDescription(
        `🗓️ Reset chaque dimanche à **00:01**\n` +
          `Début semaine: <t:${Math.floor(new Date(data.weekStartISO).getTime() / 1000)}:D>`
      )
      .setTimestamp();

    for (const type in data.quotas[user.id]) {
      const val = data.quotas[user.id][type];
      const obj = getObjectif(type);

      if (obj !== null) {
        const percent = obj > 0 ? Math.round((val / obj) * 100) : 0;
        embed.addFields({
          name: `${type} — ${val}/${obj} (${percent}%)`,
          value: "‎",
          inline: false,
        });
      } else {
        embed.addFields({
          name: type,
          value: val.toString(),
          inline: true,
        });
      }
    }

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

    const embed = new EmbedBuilder()
      .setColor("Red")
      .setTitle("Quota retiré")
      .setDescription(`❌ ${quantite} quotas retirés à ${user}`)
      .addFields(
        { name: "Type", value: type, inline: true },
        {
          name: "Total restant",
          value: data.quotas[user.id][type].toString(),
          inline: true,
        }
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // ---------- objectif-set ----------
  if (interaction.commandName === "objectif-set") {
    const type = interaction.options.getString("type");
    const quantite = interaction.options.getInteger("quantite");

    data.objectifs[type] = quantite;
    saveData();

    return interaction.reply({
      content: `🎯 Objectif mis à jour : **${type} = ${quantite}** (hebdo)`,
      ephemeral: true,
    });
  }

  // ---------- objectif-view ----------
  if (interaction.commandName === "objectif-view") {
    const embed = new EmbedBuilder()
      .setColor("Gold")
      .setTitle("🎯 Objectifs actuels (hebdo)")
      .setDescription(
        `🗓️ Reset chaque dimanche à **00:01**\n` +
          `Début semaine: <t:${Math.floor(new Date(data.weekStartISO).getTime() / 1000)}:D>`
      )
      .setTimestamp();

    const keys = Object.keys(data.objectifs || {});
    if (keys.length === 0) {
      embed.addFields({ name: "Aucun objectif", value: "—", inline: false });
    } else {
      for (const k of keys) {
        embed.addFields({ name: k, value: data.objectifs[k].toString(), inline: true });
      }
    }

    return interaction.reply({ embeds: [embed] });
  }
});

// ✅ LOGIN TOUT EN BAS (une seule fois)
client.login(TOKEN);