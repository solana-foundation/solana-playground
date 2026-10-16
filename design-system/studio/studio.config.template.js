/* ── Studio, set up for Solana Playground ─────────────────────────────────
   The toolkit is ~/Studio and carries no product. This file is the product.
   It is generated: scripts/studio-config.mjs fills in the component map from
   the design system's own data-slot names, so edit this template, not the
   copy under /studio/ on the site. */

/* The product is dark, and the system's tokens follow the class, as
   shadcn's do. The design system page keeps its own switch. */
if (!/^\/design-system/.test(location.pathname)) document.documentElement.classList.add('dark');

window.StudioConfig = {
  name: 'Playground Studio',
  colours: { accent: '#9945FF', ok: '#14F195', alt: '#38BDF8' },
  font: "'Stack Sans Text','Inter',ui-sans-serif,system-ui,-apple-system,sans-serif",

  home: '/design-system/',
  homeLabel: 'Design system',

  views: [
    { group: 'App', items: [
      { label: 'Playground', href: '/#app', note: 'The product, client-v2 as it is today', kind: 'app' },
      { label: 'Design system', href: '/design-system/', note: 'shadcn and ours, in Playground tokens', kind: 'app' },
      { label: 'Proposal deck', href: '/', note: 'The redesign, told in slides', kind: 'app' },
      { label: 'Roadmap', href: '/#roadmap', note: 'Q4 and Breakpoint', kind: 'app' }
    ]},
    { group: 'Landing', items: [
      { label: 'Landing', href: '/#landing', note: 'The page in progress', kind: 'landing' }
    ]},
    { group: 'Archive', items: [] }
  ],

  /* First the system's own parts, by the data-slot every one of them
     carries, variants before the plain part since the first match wins.
     Then client-v2 as it is today, by ids and labels, for what has not
     moved yet. */
  components: __SYSTEM__.concat([
    { name: 'Step bar',          sel: '[aria-label="Development loop"]' },
    { name: 'Step',              sel: '[id^="flow-stage-tab-"]' },
    { name: 'Step, active',      sel: '[aria-label$=": active"]' },
    { name: 'Stage panel',       sel: '[id^="flow-stage-panel-"]' },
    { name: 'Project panel',     sel: 'aside:has(#flow-left-tabpanel)' },
    { name: 'Assistant panel',   sel: 'aside:has([aria-label="Assistant sections"])' },
    { name: 'Console drawer',    sel: '#flow-console-drawer-body' },
    { name: 'Home',              sel: '#home' },
    { name: 'Resource card',     sel: 'div:has(> div > a[target="_blank"])' },
    { name: 'Terminal (xterm)',  sel: '.xterm' },
    { name: 'Terminal input',    sel: '[aria-label="Terminal input"]' },
    { name: 'Editor',            sel: '.monaco-editor' },
    { name: 'Cluster picker',    sel: '[aria-label^="Change cluster"]' },
    { name: 'Connect wallet',    sel: '[aria-label="Connect wallet"]' },
    { name: 'Sign in',           sel: '[aria-label="Sign in with GitHub"]' },
    { name: 'Settings button',   sel: '[aria-label="Open settings"]' },
    { name: 'API key field',     sel: '#assistant-api-key' },
    { name: 'Tabs',              sel: '[role=tablist]' },
    { name: 'Tab',               sel: '[role=tab]' },
    { name: 'Panel',             sel: '[role=tabpanel]' },
    { name: 'Select',            sel: '[role=combobox]' },
    { name: 'Radio group',       sel: '[role=radiogroup]' },
    { name: 'Radio',             sel: '[role=radio]' },
    { name: 'Modal',             sel: '[role=dialog]' },
    { name: 'Input',             sel: 'input[type=text], input:not([type])' },
    { name: 'Link',              sel: 'a[href]' },
    { name: 'Button',            sel: 'button' }
  ]),

  /* The decisions the Design tab offers. Each writes tokens, so everything
     built on the system follows at once. */
  presets: [
    { id: 'accent', name: 'Accent', note: 'what is current, and what acts',
      options: [
        ['purple', 'Purple', ':root,.dark{--primary:#8a3ff5 !important;--ring:#9945ff !important}'],
        ['violet', 'Violet', ':root,.dark{--primary:#6e56f8 !important;--ring:#8b7bff !important}'],
        ['green',  'Green',  ':root,.dark{--primary:#14f195 !important;--primary-foreground:#08080a !important;--ring:#14f195 !important}']
      ] },
    { id: 'radius', name: 'Corners', note: 'controls, panels and cards together',
      options: [
        ['tight', 'Tight', ':root{--radius:0.375rem !important}'],
        ['8',     'Default', ':root{--radius:0.5rem !important}'],
        ['soft',  'Soft', ':root{--radius:0.75rem !important}']
      ] },
    { id: 'density', name: 'Density', note: 'the one spacing unit every size is made of',
      options: [
        ['compact', 'Compact', ':root{--spacing:0.225rem !important}'],
        ['regular', 'Regular', ':root{--spacing:0.25rem !important}'],
        ['roomy',   'Roomy', ':root{--spacing:0.28rem !important}']
      ] },
    { id: 'weight', name: 'Weight', note: 'how heavy the type sits on the dark',
      options: [
        ['light',   'Light', ':root{--font-weight-read:320 !important;--font-weight-label:380 !important;--font-weight-act:440 !important}'],
        ['regular', 'Regular', ':root{--font-weight-read:400 !important;--font-weight-label:450 !important;--font-weight-act:520 !important}']
      ] }
  ],

  systemPage: '/design-system/',
  systemSelector: '[data-ds-block][id^="c-"]',
  systemCss: '/design-system/ds-inject.css',
  systemGround: 'dark',
  strip: ['c-brand-button-0', 'c-button-0', 'c-button-2', 'c-tag-0', 'c-badge-2', 'c-stepper-0', 'c-segmented-3', 'c-input-0'],
  essentials: [
    ['Accent', '--primary'], ['Focus ring', '--ring'], ['Brand green', '--brand-green'],
    ['Ink', '--foreground'], ['Ink, muted', '--muted-foreground'],
    ['Ground', '--background'], ['Card', '--card'], ['Popover', '--popover'],
    ['Line', '--border'], ['Field line', '--input'],
    ['Corner', '--radius'], ['Spacing unit', '--spacing'],
    ['Body size', '--text-body'], ['Reading weight', '--font-weight-read']
  ]
};
