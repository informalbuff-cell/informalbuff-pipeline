// Entry point: pick the newest article not yet posted, build its pack, fan out.
//
//   node src/run.js --dry-run     print what would be sent, touch nothing
//   node src/run.js               post to every configured platform

import fs from 'node:fs/promises';
import path from 'node:path';
import { DRY_RUN, LIMIT, telegram as telegramCfg, x as xCfg, meta as metaCfg } from './config.js';
import { recentArticles } from './site.js';
import { buildPack, articleUrl } from './copy.js';
import { cardUrl, portraitCard } from './cards.js';
import * as telegram from './platforms/telegram.js';
import * as x from './platforms/x.js';
import { postFacebook, postInstagram, hasMirrorSince } from './platforms/meta.js';

const STATE_FILE = path.join(process.cwd(), 'state', 'published.json');

async function loadState() {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  } catch {
    return { articles: {} };
  }
}

async function saveState(state) {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

function anyPlatformEnabled() {
  return telegramCfg.enabled || xCfg.enabled || metaCfg.enabled || metaCfg.igEnabled;
}

async function main() {
  if (!DRY_RUN && !anyPlatformEnabled()) {
    console.log('no platform credentials configured — nothing to do');
    return;
  }

  const state = await loadState();
  const articles = await recentArticles(40);
  const pending = articles.filter((a) => !state.articles[a.slug]).slice(0, LIMIT);

  if (!pending.length) {
    console.log('nothing new to publish');
    return;
  }

  for (const article of pending) {
    const pack = await buildPack(article);
    const link = articleUrl(article.slug);
    const headline = article.title || article.meta_title;
    const card = cardUrl({ imageUrl: article.image_url, headline });
    // Instagram fills more of the screen at 4:5 than at 1.91:1.
    const igCard = portraitCard({ imageUrl: article.image_url, headline });

    console.log(`\n=== ${article.slug}`);
    console.log(`card: ${card}`);
    console.log(`ig card: ${igCard}`);
    console.log(`telegram: ${pack.telegram.replace(/\n/g, ' | ').slice(0, 160)}`);
    console.log(`x: ${pack.x.replace(/\n/g, ' | ').slice(0, 160)}`);

    if (DRY_RUN) {
      console.log('dry run — nothing sent');
      continue;
    }

    const results = {};
    const run = async (name, fn) => {
      try {
        results[name] = await fn();
        console.log(`${name}: ${JSON.stringify(results[name])}`);
      } catch (error) {
        results[name] = { error: error.message };
        console.error(`${name}: FAILED ${error.message}`);
      }
    };

    const startedAt = Date.now();

    await run('telegram', () => telegram.post(article, pack, card));
    await run('x', () => x.post(article, pack, card));

    // Instagram first: Meta mirrors the post onto the Page by itself. Give the
    // mirror a moment, then only post to Facebook when it did not appear.
    await run('instagram', () => postInstagram(article, pack, igCard));

    if (results.instagram?.ok && metaCfg.enabled) {
      await new Promise((resolve) => setTimeout(resolve, 45_000));
      const mirrored = await hasMirrorSince(startedAt).catch(() => false);
      if (mirrored) {
        results.facebook = { skipped: 'covered by the Instagram mirror' };
        console.log('facebook: skipped — Instagram mirror already on the Page');
      } else {
        await run('facebook', () => postFacebook(article, pack, link));
      }
    } else {
      await run('facebook', () => postFacebook(article, pack, link));
    }

    // Only record the article as handled when something actually published.
    // A run with every platform skipped must not consume the story.
    const published = Object.values(results).some((r) => r && r.ok);
    if (!published) {
      console.log('nothing published for this article — leaving it for the next run');
      continue;
    }

    state.articles[article.slug] = { posted_at: new Date().toISOString(), results };
    await saveState(state);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
