/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    'discord.js',
    '@discordjs/ws',
    '@discordjs/rest',
    '@discordjs/voice',
    '@snazzah/davey',
    'play-dl',
    'puppeteer',
    'puppeteer-extra',
    'puppeteer-extra-plugin-stealth'
  ],
};

export default nextConfig;
