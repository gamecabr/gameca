#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const JOGOS_PATH = path.join(ROOT, 'data/jogos.js');
const EMBEDS_PATH = path.join(ROOT, 'data/embeds.json');
const TTL_DIAS = 7;

async function carregarJogos() {
  const src = await readFile(JOGOS_PATH, 'utf8');
  const match = src.match(/window\.JOGOS\s*=\s*(\[[\s\S]*\])\s*;?\s*$/);
  if (!match) throw new Error('window.JOGOS não encontrado em data/jogos.js');
  return JSON.parse(match[1]);
}

async function carregarCache() {
  if (!existsSync(EMBEDS_PATH)) return {};
  try {
    return JSON.parse(await readFile(EMBEDS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function cacheValido(entry) {
  if (!entry?.url || !entry?.extracted_at) return false;
  const idadeDias = (Date.now() - new Date(entry.extracted_at).getTime()) / 86400000;
  return idadeDias < TTL_DIAS;
}

function decodificarHtml(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function extrairEmbedDoHtml(html) {
  const placeholder = html.match(/data-iframe="([^"]+)"/);
  if (placeholder) {
    const decoded = decodificarHtml(placeholder[1]);
    const src = decoded.match(/src="([^"]+)"/);
    if (src && /^https?:\/\//.test(src[1])) return src[1];
  }

  const embedUpload = html.match(/https:\/\/itch\.io\/embed-upload\/\d+[^"'\s]*/);
  if (embedUpload) return embedUpload[0];

  const htmlClassic = html.match(/https:\/\/html-classic\.itch\.zone\/html\/\d+\/[^"'\s]*index\.html[^"'\s]*/);
  if (htmlClassic) return htmlClassic[0];

  return null;
}

async function extrairEmbed(urlPagina) {
  const res = await fetch(urlPagina, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; GamecaBot/1.0)',
      'Accept': 'text/html,application/xhtml+xml'
    },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  return extrairEmbedDoHtml(html);
}

async function main() {
  const jogos = await carregarJogos();
  const cache = await carregarCache();

  const alvos = jogos.filter(j => j.itch_url);

  if (!alvos.length) {
    console.log('Nenhum jogo com campo "itch_url" encontrado.');
    return;
  }

  let atualizados = 0;
  let falhas = 0;
  let cacheHits = 0;

  for (const jogo of alvos) {
    if (cacheValido(cache[jogo.id])) {
      console.log(`· ${jogo.id} — cache válido`);
      cacheHits++;
      continue;
    }

    try {
      const url = await extrairEmbed(jogo.itch_url);
      if (!url) {
        console.log(`✗ ${jogo.id} — sem embed jogável`);
        falhas++;
        continue;
      }
      cache[jogo.id] = {
        url,
        source: jogo.itch_url,
        extracted_at: new Date().toISOString()
      };
      console.log(`✓ ${jogo.id} → ${url}`);
      atualizados++;
    } catch (e) {
      console.log(`✗ ${jogo.id} — ${e.message}`);
      falhas++;
    }
  }

  await writeFile(EMBEDS_PATH, JSON.stringify(cache, null, 2) + '\n', 'utf8');
  console.log(`\nCache salvo: ${atualizados} novos, ${cacheHits} do cache, ${falhas} falhas.`);
}

main().catch(e => {
  console.error('Erro fatal:', e.message);
  process.exit(1);
});
