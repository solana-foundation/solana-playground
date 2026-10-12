import type { ThemeParam } from "../utils";

// Every colour is a token from `app/styles/playground-tokens.css`. `:root`
// holds light and `.dark` the product, so this one object serves both
// themes; `applyThemeMode` switches them. The layout floats the panels on a
// ground, with 8px gutters between them.
const BG_BASE = "var(--surface-base)", // chrome: rail, topbar, status bar, terminal
  BG_SURFACE = "var(--surface-panel)", // editor, panels
  BG_RAISED = "var(--surface-raised)", // cards, inputs, menus
  BG_HOVER = "var(--surface-hover)",
  PRIMARY = "var(--primary)",
  PRIMARY_HOVER = "var(--accent-fill-hover)",
  ON_PRIMARY = "var(--primary-foreground)",
  SECONDARY = "var(--track-brand)",
  GRADIENT = "var(--gradient-product)",
  TEXT_PRIMARY = "var(--text-primary)",
  TEXT_SECONDARY = "var(--text-secondary)",
  BORDER = "var(--border)",
  BORDER_STRONG = "var(--border-strong)",
  ERROR = "var(--error)",
  WARNING = "var(--warning)",
  INFO = "var(--info)",
  SUCCESS = "var(--success)",
  DISABLED_BG = "var(--muted)",
  SYNTAX_KEYWORD = "var(--syntax-keyword)",
  SYNTAX_TYPE = "var(--syntax-type)",
  SYNTAX_FUNCTION = "var(--syntax-function)",
  SYNTAX_STRING = "var(--syntax-string)",
  SYNTAX_NUMBER = "var(--syntax-number)",
  SYNTAX_COMMENT = "var(--syntax-comment)";

/**
 * Corner radius of every floating panel, in both layouts -- the classic
 * editor/terminal/sidebar cards and Flow's left/center/right columns, which
 * read it back through `theme.default.borderRadius`.
 */
const PANEL_RADIUS = "12px";

/** Display font for chrome (titles, buttons, topbar); code stays monospace */
const DISPLAY_FONT = `"Space Grotesk", -apple-system, BlinkMacSystemFont,
  "Segoe UI", Helvetica, Arial, sans-serif`;

const PALETTE: ThemeParam = {
  colors: {
    default: {
      bgPrimary: BG_BASE,
      bgSecondary: BG_SURFACE,
      primary: PRIMARY,
      secondary: SECONDARY,
      textPrimary: TEXT_PRIMARY,
      textSecondary: TEXT_SECONDARY,
      border: BORDER,
    },
    state: {
      disabled: { bg: DISABLED_BG, color: TEXT_SECONDARY },
      error: { color: ERROR },
      hover: { bg: BG_HOVER, color: TEXT_PRIMARY },
      info: { color: INFO },
      success: { color: SUCCESS },
      warning: { color: WARNING },
    },
  },

  font: {
    other: {
      family: DISPLAY_FONT,
      size: {
        xsmall: "0.8125rem",
        small: "0.875rem",
        medium: "1rem",
        large: "1.375rem",
        xlarge: "1.75rem",
      },
    },
  },

  default: {
    backdrop: { backdropFilter: "blur(12px)" },
    borderRadius: PANEL_RADIUS,
    boxShadow: "var(--shadow-panel-value)",
  },

  components: {
    button: {
      default: {
        borderRadius: "9999px",
        fontFamily: DISPLAY_FONT,
      },
      overrides: {
        primary: {
          color: ON_PRIMARY,
          hover: { bg: PRIMARY_HOVER },
        },
        outline: {
          border: `1px solid ${BORDER_STRONG}`,
          hover: {
            bg: BG_HOVER,
            borderColor: BORDER_STRONG,
          },
        },
      },
    },
    editor: {
      default: {
        bg: "transparent",
        activeLine: { borderColor: BORDER },
      },
      gutter: {
        bg: "transparent",
        color: SYNTAX_COMMENT,
        activeColor: TEXT_SECONDARY,
      },
      wrapper: { bg: BG_SURFACE },
      peekView: {
        title: { bg: BG_BASE },
        editor: { bg: BG_BASE },
      },
      tooltip: { bg: BG_RAISED },
    },
    input: {
      bg: BG_RAISED,
      borderColor: BORDER,
      padding: "0.4375rem 0.75rem",
    },
    menu: {
      default: {
        bg: BG_RAISED,
        border: `1px solid ${BORDER}`,
      },
    },
    modal: {
      default: {
        bg: "color-mix(in srgb, var(--surface-raised) 90%, transparent)",
        border: `1px solid ${BORDER}`,
        boxShadow: "var(--shadow-modal-value)",
      },
    },
    progressbar: {
      indicator: { bg: GRADIENT },
    },
    skeleton: {
      bg: BG_RAISED,
      highlightColor: BG_HOVER,
    },
    tabs: {
      default: {
        bg: BG_BASE,
        borderBottom: `1px solid ${BORDER}`,
      },
      tab: {
        default: {
          paddingLeft: "0.75rem",
          color: TEXT_SECONDARY,
          // No boxed dividers between tabs — the current tab stands out by
          // surface + accent instead
          borderRightColor: "transparent",
          hover: { bg: BG_HOVER },
        },
        current: {
          bg: BG_SURFACE,
          color: TEXT_PRIMARY,
          borderTopColor: PRIMARY,
        },
      },
    },
    terminal: {
      default: { bg: BG_BASE },
    },
    toast: {
      default: {
        bg: BG_RAISED,
        border: `1px solid ${BORDER}`,
        // react-toastify's 64px min-height inflates a single-line toast
        minHeight: "3rem",
        padding: "0.5rem 0.75rem",
      },
      progress: { bg: GRADIENT },
    },
    topbar: {
      bg: BG_BASE,
      boxShadow: "none",
      borderBottom: `1px solid ${BORDER}`,
      fontFamily: DISPLAY_FONT,
    },
    tooltip: {
      bg: BG_RAISED,
      bgSecondary: BG_BASE,
    },
    wallet: {
      default: {
        bg: BG_RAISED,
        border: `1px solid ${BORDER}`,
      },
      main: {
        transactions: {
          table: {
            default: { bg: BG_SURFACE },
            header: { bg: BG_BASE },
          },
        },
      },
    },
  },

  views: {
    bottom: {
      bg: BG_BASE,
      color: TEXT_SECONDARY,
      // The floating panels above never touch the status bar - a divider
      // would be a line hanging in empty black
      borderTop: "none",
    },
    main: {
      // Floating-panel composition: the main column is part of the black
      // canvas; editor and terminal are inset cards separated by 8px gutters
      default: {
        bg: BG_BASE,
        padding: "0.5rem 0.5rem 0.5rem 0.5rem",
        gap: "0.5rem",
      },
      primary: {
        default: {
          bg: BG_SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: PANEL_RADIUS,
          overflow: "hidden",
        },
        home: {
          // Home is a content surface - prose belongs to the display font
          default: { bg: BG_SURFACE, fontFamily: DISPLAY_FONT },
          title: {
            fontFamily: DISPLAY_FONT,
            fontSize: "2.25rem",
            fontWeight: 700,
            letterSpacing: "-0.01em",
          },
          resources: {
            card: {
              default: {
                bg: BG_RAISED,
                border: `1px solid ${BORDER}`,
                borderRadius: "16px",
              },
            },
          },
          tutorials: {
            card: {
              bg: BG_RAISED,
              border: `1px solid ${BORDER}`,
              borderRadius: "16px",
            },
          },
        },
      },
      secondary: {
        // The terminal floats as its own black card - one shade below the
        // editor surface, delineated by the border instead of a divider
        default: {
          bg: BG_BASE,
          border: `1px solid ${BORDER}`,
          // Override the default purple divider - the card border does the job
          borderTop: `1px solid ${BORDER}`,
          borderRadius: PANEL_RADIUS,
          overflow: "hidden",
        },
      },
    },
    sidebar: {
      // The gap separates the rail from the floating page panel; vertical
      // padding aligns the panel with the editor card next to it
      default: {
        bg: BG_BASE,
        gap: "0.5rem",
        padding: "0.5rem 0",
      },
      left: {
        default: {
          bg: BG_BASE,
          borderRight: "none",
          width: "3.5rem",
        },
        button: {
          // Rounded 40px squares centered in the rail instead of full-width
          // strips; the active page is a raised pill, not a border edge
          default: {
            width: "2.5rem",
            height: "2.5rem",
            margin: "0.25rem 0",
            borderRadius: "10px",
            hover: { bg: BG_HOVER },
          },
          selected: {
            bg: BG_RAISED,
            // Set every side explicitly - the defaults machinery appends
            // borderLeft/borderRight *after* these, so shorthand alone
            // would be overridden by the legacy 2px edge marker
            border: `1px solid ${BORDER_STRONG}`,
            borderLeft: `1px solid ${BORDER_STRONG}`,
            borderRight: `1px solid ${BORDER_STRONG}`,
          },
        },
      },
      right: {
        default: {
          bg: BG_SURFACE,
          otherBg: BG_SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: PANEL_RADIUS,
          overflow: "hidden",
          // The wrapper hardcodes `calc(100vh - bottom)` before this block;
          // subtract the 2x0.5rem vertical gutters the Side wrapper adds
          height: "calc(100vh - 1.5rem - 1rem)",
        },
        title: {
          // 40px panel header on the 8px rhythm
          height: "2.5rem",
          fontFamily: DISPLAY_FONT,
          fontSize: "1rem",
          fontWeight: 500,
          letterSpacing: "0.04em",
          // Left-aligned header row instead of the legacy centered banner.
          // Later declarations here override the wrapper's hardcoded
          // `justify-content: center`, so no component edit is needed.
          justifyContent: "flex-start",
          paddingLeft: "1rem",
        },
      },
    },
  },

  highlight: {
    typeName: { color: SYNTAX_TYPE, fontStyle: "italic" },
    variableName: { color: TEXT_PRIMARY },
    constant: { color: TEXT_PRIMARY },
    namespace: { color: SYNTAX_TYPE },
    macroName: { color: SYNTAX_FUNCTION },
    functionCall: { color: SYNTAX_FUNCTION },
    functionDef: { color: SYNTAX_FUNCTION },
    functionArg: { color: TEXT_PRIMARY },
    definitionKeyword: { color: SYNTAX_KEYWORD },
    moduleKeyword: { color: SYNTAX_KEYWORD },
    modifier: { color: SYNTAX_KEYWORD },
    controlKeyword: { color: SYNTAX_KEYWORD },
    operatorKeyword: { color: SYNTAX_KEYWORD },
    keyword: { color: SYNTAX_KEYWORD },
    self: { color: SYNTAX_KEYWORD },
    bool: { color: SYNTAX_NUMBER },
    integer: { color: SYNTAX_NUMBER },
    literal: { color: SYNTAX_NUMBER },
    string: { color: SYNTAX_STRING },
    character: { color: SYNTAX_STRING },
    operator: { color: SYNTAX_KEYWORD },
    derefOperator: { color: SYNTAX_KEYWORD },
    specialVariable: { color: SYNTAX_NUMBER },
    lineComment: { color: SYNTAX_COMMENT },
    blockComment: { color: SYNTAX_COMMENT },
    meta: { color: SYNTAX_NUMBER },
    regexp: { color: SYNTAX_STRING },
  },
};

export default PALETTE;
