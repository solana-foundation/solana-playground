# Tutorials

Playground now supports [tutorials](https://beta.solpg.io/tutorials) natively with both Markdown and custom React components.

> **Conversation tutorials**
>
> A tutorial on the conversation flow is one `tutorial.json`, which an agent
> can write from [`AUTHORING.md`](AUTHORING.md) and
> [`tutorial.schema.json`](tutorial.schema.json);
> [`DRAFTING.md`](DRAFTING.md) is the how-to for a person drafting one with
> an LLM. This page covers the Markdown and React tutorials only.

Table of contents:

- [How to add a tutorial](#how-to-add-a-tutorial)
- [Markdown tutorials](#markdown-tutorials)
- [Custom tutorials](#custom-tutorials)
- [Storing assets](#storing-assets)
- [Send pull requests](#send-pull-requests)

## How to add a tutorial

First, fork this repository and [run locally](../../README.md#setup).

Next, follow the steps for your desired tutorial type:

- [Markdown tutorials](#markdown-tutorials) (recommended)
- [Custom tutorials](#custom-tutorials).

## Markdown tutorials

The easiest way to add a tutorial is with Markdown text.

> **Note**
>
> You do **NOT** need to know anything about the playground codebase.

### Steps

Make sure you've done the initial setup mentioned in [How to add a tutorial](#how-to-add-a-tutorial).

1. Create a tutorial directory based on the tutorial template

   Copy the template directory at [`client-v2/public/tutorials/__template`](../../public/tutorials/__template) and rename the directory to your tutorial's kebab-case name e.g. if your tutorial name is "Cool Tutorial" rename the directory you copied to "cool-tutorial".

2. Adjust the template files as necessary:

   - `data.json`: Tutorial data
   - `thumbnail.(png|jpg)`: Tutorial thumbnail
   - `about.md`: About section for the tutorial that will be shown on the main page for the tutorial
   - `pages`: All of your tutorial pages starting from `1.md`
   - `files`: Initial files to create when the tutorial first starts

3. Enable the tutorial

   Add an entry for the directory name to [`markdown-tutorials.json`](markdown-tutorials.json), with `added` set to the Unix time in seconds when the tutorial is added: `"cool-tutorial": { "added": 1735689600 }`. The app shows only the tutorials listed there, and the build reads `added` as the tutorial's `unixTimestamp`. A listed name without its directory or `data.json` fails the build.

4. [Send pull requests](#send-pull-requests)

## Custom tutorials

Since tutorials are made with React components, you are not limited to making tutorials with Markdown. Not only you can create and display your own components but you also have access to all of the playground codebase!

For example, you can run any code whenever the user changes the page.

```tsx
<Tutorial
  // ...
  pages={[
    {
      // ...
      onMount: () => PgTerminal.println("I'm controlling the terminal!"),
    },
  ]}
/>
```

### Steps

Make sure you've done the initial setup mentioned in [How to add a tutorial](#how-to-add-a-tutorial).

1. Copy the `__template` directory

2. Rename the directory and file names to fit your tutorial's name e.g. if your tutorial name is "Cool Tutorial", rename the:

   - Directory to `cool-tutorial`
   - `__template.ts` file to `cool-tutorial.ts`
   - `Template.tsx` file to `CoolTutorial.tsx`

3. Change content

   You can take inspiration from the existing tutorials like `hello-*` tutorials, e.g. `hello-anchor`.

4. [Send pull requests](#send-pull-requests)

## Storing assets

Tutorial assets live in `client-v2/public/tutorials/<tutorial-name>/` and are added in the same pull request as the tutorial.

> **Warning**
>
> Please try to keep each image less than 1MB, especially the thumbnail. Tutorial thumbnails are shown as `278x216` pixels by default and the assets are used as-is(no altering in order to reduce size) which means there is no reason to upload a 4K 10MB image as a thumbnail.

### Thumbnail

In order to add a thumbnail for your tutorial, put a file named `thumbnail.(png|jpg)` in your tutorial's asset folder. For example, if you have a tutorial named `Cool Tutorial`, add the image to the `/tutorials/cool-tutorial/` directory.

### Show assets in Markdown

The assets can be included in the Markdown files with the following syntax:

```md
![<DESCRIPTION>](<IMAGE_NAME>)
```

**Example:**

```md
![Test UI](test-ui.png)
```

## Send pull requests

After you've finished preparing your tutorial, the last step is to send a pull request with the tutorial, its assets, and its `markdown-tutorials.json` entry to this repository.
