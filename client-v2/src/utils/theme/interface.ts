import { StandardProperties } from "csstype";
import { ITerminalOptions as XtermOptions } from "xterm";

import { AllRequired, NestedRequired } from "../types";

/** Playground theme */
export interface ThemeParam {
  /**
   * Colors of the theme.
   *
   * NOTE: Optional theme properties will be derived from the following colors
   * if they are not specified during creation.
   */
  colors: {
    /** Default colors */
    default: {
      primary: string;
      secondary: string;
      bgPrimary: string;
      bgSecondary: string;
      textPrimary: string;
      textSecondary: string;
      border: string;
    };

    /** State colors */
    state: {
      hover: StateColor;
      disabled: StateColor;
      error: StateColor;
      success: StateColor;
      warning: StateColor;
      info: StateColor;
    };
  };

  /**
   * Fonts of the theme.
   *
   * Optional overrides; when not set, the code font comes from the font
   * setting and the non-code font falls back to the system stack.
   */
  font?: {
    /** Code font */
    code?: Font;
    /** Any font other than code(e.g Markdown) */
    other?: Font;
  };

  /** Default theme values */
  default?: {
    /** Default backdrop */
    backdrop?: DefaultStyles;

    /** Default border radius */
    borderRadius?: StandardProperties["borderRadius"];

    /** Default box shadow */
    boxShadow?: StandardProperties["boxShadow"];

    /** Default scrollbar */
    scrollbar?: {
      thumb: {
        color: Color;
        hoverColor: Color;
      };
    };

    /** Default transition settings */
    transition?: {
      /** Timing function */
      type: StandardProperties["transitionTimingFunction"];
      /** Transition durations */
      duration: {
        [K in
          | "short"
          | "medium"
          | "long"]: StandardProperties["transitionDuration"];
      };
    };
  };

  /** Override the component defaults */
  components?: {
    /** Card component */
    card?: DefaultComponent;

    /** Editor component */
    editor?: {
      /** Editor defaults */
      default?: BgAndColor & {
        cursorColor?: Color;
        activeLine?: BgAndColor & Pick<StandardProperties, "borderColor">;
        selection?: BgAndColor;
        searchMatch?: BgAndColor & {
          selectedBg?: Bg;
          selectedColor?: Color;
        };
      } & Pick<StandardProperties, "fontFamily" | "fontSize">;

      /** Gutter component */
      gutter?: BgAndColor & {
        activeBg?: Bg;
        activeColor?: Color;
      } & Pick<StandardProperties, "borderRight">;

      /** Inlay hints */
      inlayHint?: BgAndColor & {
        parameterBg?: Bg;
        parameterColor?: Color;
        typeBg?: Bg;
        typeColor?: Color;
      };

      /** Minimap component */
      minimap?: {
        bg?: Bg;
        selectionHighlight?: Color;
      };

      /** Peek view component */
      peekView?: {
        /** Peek view title */
        title?: {
          bg?: Bg;
          labelColor?: Color;
          descriptionColor?: Color;
        };
        /** Peek view editor */
        editor?: {
          bg?: Bg;
          matchHighlightBg?: Bg;
          gutterBg?: Bg;
        };
        /** Peek view result(right side) */
        result?: {
          bg?: Bg;
          lineColor?: Color;
          fileColor?: Color;
          selectionBg?: Bg;
          selectionColor?: Color;
          matchHighlightBg?: Bg;
        };
      } & Pick<StandardProperties, "borderColor">;

      /**
       * Tooltip or widget component: Monaco's hover, suggest and dropdown
       * widgets read it. It stays though the design system's tooltip does not.
       */
      tooltip?: BgAndColor & {
        selectedBg?: Bg;
        selectedColor?: Color;
      } & Pick<StandardProperties, "borderColor">;

      /** Editor wrapper component */
      wrapper?: DefaultComponent;
    };

    /** Input component */
    input?: DefaultComponent;

    /** Markdown component */
    markdown?: DefaultComponent & { subtleBg?: Bg };

    /** Skeleton component */
    skeleton?: DefaultComponent & {
      highlightColor?: Color;
    };

    /** SVG component */
    svg?: DefaultComponent;

    /** Tabs component */
    tabs?: ExtendibleComponent<{
      tab?: ExtendibleComponent<
        "selected" | "current" | "drag" | "dragOverlay"
      >;
    }>;

    /** Terminal component */
    terminal?: ExtendibleComponent<{
      xterm?: {
        [K in
          | "textPrimary"
          | "textSecondary"
          | "primary"
          | "secondary"
          | "success"
          | "error"
          | "warning"
          | "info"]?: Color;
      } & {
        selectionBg?: Bg;
        cursor?: {
          color?: Color;
          accentColor?: Color;
          blink?: XtermOptions["cursorBlink"];
          kind?: XtermOptions["cursorStyle"];
        };
      };
    }>;

    /** Topbar component (e.g. top section of primary main view) */
    topbar?: DefaultComponent;

    /**
     * Tooltip component. The design system's tooltip no longer reads it, but
     * `Settings`, `Build`, `Deploy` and `Stepper` still read `tooltip.bg` for
     * parts that are not tooltips, so the section stays until the global
     * reset (ui-migration 5.24).
     */
    tooltip?: DefaultStyles & { bgSecondary?: Bg };

    /** Tutorial component */
    tutorial?: ExtendibleComponent<"aboutPage" | "tutorialPage">;

    /** Upload area component */
    uploadArea?: ExtendibleComponent<{
      /** Upload icon */
      icon?: DefaultComponent;
      /** Upload message */
      text?: ExtendibleComponent<"error" | "success">;
    }>;

    /** Wallet component */
    wallet?: ExtendibleComponent<{
      /** Top side of the wallet component */
      top?: ExtendibleComponent<{
        /** Wallet title component */
        title?: ExtendibleComponent<"icon" | "text">;
      }>;
      /** Main side of the wallet component */
      main?: ExtendibleComponent<{
        /** Backdrop is made with `::after` pseudo class */
        backdrop?: DefaultStyles;
        /** Balance section */
        balance?: DefaultComponent;
        /** Send section */
        send?: ExtendibleComponent<{
          /** Send section foldable title text */
          title?: DefaultComponent;
          /** Expanded send component */
          expanded?: ExtendibleComponent<"input">;
        }>;
        /** Transaction history section */
        transactions?: ExtendibleComponent<{
          /** Transactions title */
          title?: ExtendibleComponent<"text">;
          /** Transactions table */
          table?: ExtendibleComponent<{
            /** Transactions table header */
            header?: DefaultComponent;
            /** Transactions table row */
            row?: ExtendibleComponent<"signature" | "slot" | "time">;
          }>;
        }>;
      }>;
    }>;
  };

  /** Override view defaults */
  views?: {
    /** Bottom bar view */
    bottom?: DefaultComponent;

    /** Main view */
    main?: ExtendibleComponent<{
      /** Main primary view */
      primary?: ExtendibleComponent<{
        /** Home view */
        home?: ExtendibleComponent<{
          /** Playground title */
          title?: DefaultComponent;
          /** Resources section */
          resources?: ExtendibleComponent<{
            /** Resources title */
            title?: DefaultComponent;
            /** Resource card */
            card?: ExtendibleComponent<"image" | "title" | "description">;
          }>;
          /** Tutorials section */
          tutorials?: ExtendibleComponent<"title" | "card">;
        }>;
      }>;

      /** Main secondary view */
      secondary?: ExtendibleComponent<{
        /** Main secondary tabs */
        tabs?: ExtendibleComponent<{
          /** Main secondary tab */
          tab?: ExtendibleComponent<"current">;
        }>;
      }>;
    }>;

    /** Sidebar view */
    sidebar?: ExtendibleComponent<{
      /** Left side of the side panel (icon panel) */
      left?: ExtendibleComponent<{
        /** Left sidebar icon button */
        button?: ExtendibleComponent<"selected">;
      }>;

      /** Right side of the side panel */
      right?: ExtendibleComponent<
        "title" | "content",
        { otherBg?: Bg; initialWidth?: StandardProperties["width"] }
      >;
    }>;
  };

  /** Code highlight styles */
  highlight: HighlightParam;
}

/** Syntax highlighting styles parameter */
interface HighlightParam {
  /** let x: *bool* = true; */
  typeName: HighlightToken;
  /** let *x*: bool = true; */
  variableName: HighlightToken;
  /** const *x*: bool = true; */
  constant: HighlightToken;
  /** *String*::new(); */
  namespace: HighlightToken;
  /** *println!*() */
  macroName: HighlightToken;
  /** *myFn*() */
  functionCall: HighlightToken;
  /** a.*to*lowercase*() */
  functionDef: HighlightToken;
  /** myFn(*arg*: bool) */
  functionArg: HighlightToken;
  /** const macro*rules struct union enum type fn impl trait let static */
  definitionKeyword: HighlightToken;
  /** mod use crate */
  moduleKeyword: HighlightToken;
  /** pub unsafe async mut extern default move */
  modifier: HighlightToken;
  /** for if else loop while match continue break return await */
  controlKeyword: HighlightToken;
  /** as in ref */
  operatorKeyword: HighlightToken;
  /** where crate super dyn */
  keyword: HighlightToken;
  /** self */
  self: HighlightToken;
  /** true */
  bool: HighlightToken;
  /** 5 */
  integer: HighlightToken;
  /** 5.5 */
  literal: HighlightToken;
  /** "" + b"" + r#""# */
  string: HighlightToken;
  /** ' */
  character: HighlightToken;
  /** & */
  operator: HighlightToken;
  /** * */
  derefOperator: HighlightToken;
  /** Lifetime &*'a* */
  specialVariable: HighlightToken;
  /** Comment with `//` */
  lineComment: HighlightToken;
  /** Comment with `///` */
  blockComment: HighlightToken;
  /** # */
  meta: HighlightToken;
  /** /expr/ */
  regexp: HighlightToken;
}

/** Syntax highlighting styles */
export type Highlight = {
  [K in keyof HighlightParam]: Exclude<HighlightToken, string>;
};

/** Syntax highlighting token */
type HighlightToken = string | Pick<StandardProperties, "color" | "fontStyle">;

/** Playground font */
export interface Font {
  family: NonNullable<StandardProperties["fontFamily"]>;
  size: {
    [K in "xsmall" | "small" | "medium" | "large" | "xlarge"]: NonNullable<
      StandardProperties["fontSize"]
    >;
  };
  /** Whether the font should be used as the default font */
  isDefault?: boolean;
}

/** Importable(lazy) theme */
export interface ImportableThemeParam {
  /** Name of the theme that's displayed in theme settings */
  name: string;
  /** Whether the theme is a dark theme */
  isDark?: boolean;
  /** Whether the theme should be used as the default theme */
  isDefault?: boolean;
  /** Import promise for the theme to lazy load */
  import?: () => Promise<{
    default: ThemeParam;
  }>;
}

/** Importable(lazy) theme */
export type ImportableTheme = Required<ImportableThemeParam>;

/** Components that use `DefaultComponent` type */
type DefaultComponents =
  | "card"
  | "input"
  | "skeleton"
  | "svg"
  | "tooltip"
  | "topbar";

/** Components that use `ExtendibleComponent` type */
type ExtendibleComponents =
  | "editor"
  | "markdown"
  | "tabs"
  | "terminal"
  | "tutorial"
  | "uploadArea"
  | "wallet";

/** Theme to be used while setting the defaults internally */
export type ThemeInternal = Omit<ImportableTheme, "import"> &
  ThemeParam & {
    /** Default font */
    font?: {
      /** Code font */
      code?: Font;
      /** Any font other than code(e.g Markdown) */
      other?: Font;
    };
  };

/**
 * Ready to be used theme. Some of the optional properties will be overridden
 * with default values.
 */
export type Theme<
  T extends ThemeInternal = ThemeInternal,
  C extends NonNullable<T["components"]> = NonNullable<T["components"]>,
  V extends NonNullable<T["views"]> = NonNullable<T["views"]>
> = NestedRequired<T> & {
  // Default components
  components: Pick<C, DefaultComponents>;
} & {
  // Extendible components
  components: AllRequired<Pick<C, ExtendibleComponents>>;
} & {
  // All views
  views: AllRequired<V>;
} & {
  // Code syntax highlighting
  highlight: Highlight;
};

/** Properties that are allowed to be specified from theme objects */
type DefaultStyles = {
  bg?: Bg;
} & AnyProperty & { [key: string]: any };
// & StandardProperties
// FIXME: Using `StandardProperties` makes TypeScript extremely slow.

/** StandardProperties pseudo classes */
type PseudoClass =
  | "hover"
  | "active"
  | "focus"
  | "focusWithin"
  | "before"
  | "after";

/** Default component pseudo classes */
type DefaultComponentState<T extends PseudoClass = PseudoClass> = {
  [K in T]?: DefaultComponent;
};

/**
 * Specify any property that starts with `&`.
 *
 * NOTE: Usage of this should be avoided when possible because expressions such
 * as `& > div:nth-child(3)` will break if the layout of of the component changes
 * and TypeScript will not catch the error.
 */
type AnyProperty<T extends string = string> = {
  [K in `&${T}`]?: DefaultComponent;
};

/** Default component with pseudo classes */
export type DefaultComponent = DefaultStyles & DefaultComponentState;

/** Extendible component */
type ExtendibleComponent<
  T extends string | object,
  D = {},
  U = T extends string
    ? {
        [K in T]?: DefaultComponent;
      }
    : T
> = {
  default?: DefaultComponent & D;
} & (T extends string
  ? { [K in U extends any ? keyof U : never]?: DefaultComponent }
  : U);

/** StandardProperties background */
type Bg = string;

/** StandardProperties color */
type Color = NonNullable<StandardProperties["color"]>;

/** Optional background and color */
type BgAndColor = { bg?: Bg } & { color?: Color };

/** Required color, optional background */
type StateColor = {
  color: Color;
} & {
  bg?: Bg;
};

/** Theme color names */
export type ThemeColor =
  | keyof Pick<
      Theme["colors"]["default"],
      "primary" | "secondary" | "textPrimary" | "textSecondary"
    >
  | keyof Omit<Theme["colors"]["state"], "hover" | "disabled">;
