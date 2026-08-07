# FluentFlow Vocab Static CDN

Static vocabulary pages for FluentFlow.

## Build

From this folder:

```bash
npm run build
```

The script reads:

```text
../fluentflow/words/corpus/entries
```

and writes paginated static JSON into:

```text
public/
```

## Deploy to Vercel

Commit the generated `public/` folder to this repository, then create a new Vercel project from it. Use:

```text
Build command: echo 'Using committed public vocabulary files'
Output directory: public
```

Then set this in the FluentFlow app:

```env
NEXT_PUBLIC_VOCAB_CDN_URL=https://your-vocab-project.vercel.app
```

## URL Shape

```text
/manifest.json
/entries/{language}/{level}/page-{page}.json
```

Example:

```text
/entries/fr/A1/page-1.json
```
