require("dotenv").config();
client.login(process.env.DISCORD_TOKEN);
const { 
    Client, 
    GatewayIntentBits, 
    SlashCommandBuilder, 
    REST, 
    Routes,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const fs = require('fs');

const TOKEN = 'DISCORD_TOKEN';


const CLIENT_ID = '1474765313265631232';
const GUILD_ID = '1472247163160629425';

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// Charger les données
let quotas = {};
if (fs.existsSync('./data.json')) {
    quotas = JSON.parse(fs.readFileSync('./data.json'));
}

// Sauvegarde auto
function saveData() {
    fs.writeFileSync('./data.json', JSON.stringify(quotas, null, 2));
}

// Commandes
const commands = [

    new SlashCommandBuilder()
        .setName('quota-add')
        .setDescription('Ajouter un quota')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option =>
            option.setName('membre')
                .setDescription('Membre')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Type (ex: menu)')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('quantite')
                .setDescription('Quantité')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('quota-view')
        .setDescription('Voir les quotas d’un membre')
        .addUserOption(option =>
            option.setName('membre')
                .setDescription('Membre')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('quota-remove')
        .setDescription('Retirer un quota')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option =>
            option.setName('membre')
                .setDescription('Membre')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Type')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('quantite')
                .setDescription('Quantité')
                .setRequired(true)),

].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands }
    );
    console.log('✅ Commandes enregistrées');
})();

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const user = interaction.options.getUser('membre');

    if (!quotas[user.id]) {
        quotas[user.id] = {};
    }

    if (interaction.commandName === 'quota-add') {

        const type = interaction.options.getString('type');
        const quantite = interaction.options.getInteger('quantite');

        if (!quotas[user.id][type]) {
            quotas[user.id][type] = 0;
        }

        quotas[user.id][type] += quantite;
        saveData();

        const embed = new EmbedBuilder()
            .setColor('Green')
            .setTitle('Quota ajouté')
            .setDescription(`✅ ${quantite} quotas ajoutés à ${user}`)
            .addFields({ name: 'Type', value: type, inline: true },
                       { name: 'Total', value: quotas[user.id][type].toString(), inline: true })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'quota-view') {

        if (Object.keys(quotas[user.id]).length === 0) {
            return interaction.reply("Aucun quota trouvé.");
        }

        const embed = new EmbedBuilder()
            .setColor('Blue')
            .setTitle(`Quotas de ${user.username}`)
            .setTimestamp();

        for (const type in quotas[user.id]) {
            embed.addFields({
                name: type,
                value: quotas[user.id][type].toString(),
                inline: true
            });
        }

        await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'quota-remove') {

        const type = interaction.options.getString('type');
        const quantite = interaction.options.getInteger('quantite');

        if (!quotas[user.id][type]) {
            return interaction.reply("Ce quota n'existe pas.");
        }

        quotas[user.id][type] -= quantite;

        if (quotas[user.id][type] < 0) {
            quotas[user.id][type] = 0;
        }

        saveData();

        const embed = new EmbedBuilder()
            .setColor('Red')
            .setTitle('Quota retiré')
            .setDescription(`❌ ${quantite} quotas retirés à ${user}`)
            .addFields({ name: 'Type', value: type, inline: true },
                       { name: 'Total restant', value: quotas[user.id][type].toString(), inline: true })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
});

client.login(TOKEN);