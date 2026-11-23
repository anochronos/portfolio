# Akshun Kalra | Portfolio

My personal site, built with Nuxt 4 and generated as static files for GitHub Pages.

## Run it

You need Node 24.15 or newer (22.22.3 or newer on the 22 line also works). Check with `node --version`; `.nvmrc` pins the major version for nvm users.

```bash
npm install
npm run dev        # http://localhost:3000
npm run generate   # static build into .output/public
```

## Where things live

| Path | What it holds |
| --- | --- |
| `app/data/projects.ts` | Every project: title, text, tech, links and image. The work strip and the project pages both read from here. |
| `app/pages/index.vue` | The home page, one component per section. |
| `app/pages/work/[slug].vue` | The page each tile links to. |
| `app/components/HeroSection.vue` | Your name: the first name riding the swell, the surname under water. |
| `app/components/TowIn.vue` | The opening: the boat towing the first name in, the jellyfish lifting the surname. |
| `app/components/SeaScene.vue` | Hands the page's layout to the sea and its background thread. |
| `app/utils/sea/engine.ts` | The sea itself: water, sky, boat, jellyfish, creatures and reef, drawn in characters. |
| `app/components/SeaCursor.vue` | The moon and submarine cursor, and the submarine cruising on its own. |
| `app/components/ShipCalls.vue` | The crew's speech bubbles from the boat. |
| `app/components/WorkStrip.vue` | The row of tiles that slides sideways as you scroll. |
| `app/components/AsciiImage.vue` | Turns a tile's picture into characters as it leaves the centre. |
| `app/components/DepthMeter.vue` | The depth gauge down the right edge, in place of the scrollbar. |
| `app/components/ArcadeMode.vue` | A hidden game, "The deep end". Open it with the Konami code (↑ ↑ ↓ ↓ ← → ← → B A), by typing `dive`, or by clicking or tapping the moon three times quickly. The crab on the sea floor (`CrabSecret.vue`) whispers the secret to anyone who clicks through its speech bubble. |
| `app/utils/sound.ts` | All the sound, and the music (see Credits). `SoundSwitch.vue` is its switch and volume meter. |
| `app/utils/lite.ts` | The lighter drawing mode for computers without graphics acceleration (see below). |
| `app/utils/ascii.ts` | The character ramp, the seven-hue palette and the glyph atlas the canvases share. |
| `app/assets/css/main.css` | All styling. Colours, type sizes and spacing are variables at the top. |
| `public/` | Files served as they are: `CNAME`, `resume.pdf`, fonts and images. |

## Without graphics acceleration

On a computer drawing without graphics acceleration (or with it switched off in the browser), the site switches itself to a lighter mode: the sea's canvases at ordinary resolution, its glow blended in its background thread, a slightly lower frame rate, the pictures holding still, and no CRT lines or blurs. It also switches if it measures itself running slowly after the opening. To see either mode on any computer, set `localStorage['sea-quality']` to `'lite'` or `'full'` in the browser console and reload.

## Adding a project screenshot

1. Put the image in `public/images/projects/`.
2. In `app/data/projects.ts`, add `image: '/images/projects/your-file.png'` and an `imageAlt` to that project.

A project with no `image` gets a generated pattern on its tile instead.

Your photo appears only in the About section: replace `public/profile.jpg` to change it.

## Deploying

`.github/workflows/deploy.yml` builds the site and publishes it on every push to `main`. For that to work, set the repository's Pages source to "GitHub Actions" under Settings, Pages. Set the custom domain there too: a site published by a workflow ignores `public/CNAME`, which is kept only as a record of the domain.

## Credits

- The ASCII jellyfish is inspired by [dang0321/code-art](https://github.com/dang0321/code-art). That repo is all rights reserved and asks for a link back when you publish work made with reference to it, which this README gives. None of its code is copied here.
- The music is "Bread" by Lukrembo, from [Free To Use](https://freetouse.com/music) (`public/audio/bread.mp3`, re-encoded at 128 kbps). Free To Use's free license only covers videos on social platforms; a website needs their Commercial plan or a single-track license, so get one of those before publishing with the music in. To take the music out, delete the file: the rest of the sound works without it.
- The code in this repo was written for this site.
- Typefaces: Inter Tight and JetBrains Mono, both under the SIL Open Font License (`public/fonts/`).
