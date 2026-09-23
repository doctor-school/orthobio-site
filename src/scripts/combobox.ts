/**
 * The sign-up form's list fields (Issue #88, design `Combo`): an editable
 * `role="combobox"` input with its own `role="listbox"` popup, in place of the
 * native `<datalist>` whose look no stylesheet can reach.
 *
 * The widget only SUGGESTS. It never decides what a value resolves to — the
 * form's own change/blur/submit handlers still do that through
 * `lib/specialty.ts` and `lib/settlements.ts` — so a participant who types and
 * tabs away gets exactly the behaviour the form had before; picking an option
 * is a shortcut to the same result, reported through `onPick`.
 *
 * A typed text that is exactly one option's whole name (for a place, also its
 * full «Кировск — Мурманская область» label) commits that option
 * and closes the list at once (`soleExactMatch`): a list left open under a
 * finished entry covers the fields below it, and the next click aimed at one
 * of them would land on an option. Several same-named options («Кировск» ×3)
 * keep the list open — the participant still has to choose.
 *
 * Keyboard (WAI-ARIA combobox, list autocomplete): typing filters and makes
 * the first option active; ArrowDown opens / moves, Alt+ArrowDown opens,
 * ArrowUp moves, Enter picks the active option, Escape closes, Tab closes and
 * moves on without picking. Focus never leaves the input: the active option is
 * announced through `aria-activedescendant`, and an option press is kept from
 * blurring the input.
 *
 * The filtering, highlight split and index maths are `lib/combobox.ts`, where
 * they are unit-tested.
 */
import {
  type ExactMatchOptions,
  filterOptions,
  foldQuery,
  moveActive,
  soleExactMatch,
  splitHighlight,
} from '@/lib/combobox';

export interface ComboboxConfig<T> {
  input: HTMLInputElement;
  list: HTMLElement;
  /** The decorative chevron; a press toggles the list. */
  toggle?: HTMLElement | null;
  /** The options at this moment (the source may still be loading). */
  options: () => readonly T[];
  /** Always listed last, under a hairline, whatever was typed. */
  pinned?: () => T | null;
  text: (option: T) => string;
  /** Muted tail after the text («— Московская область»). */
  sub?: (option: T) => string | null;
  normalise?: (foldedQuery: string) => string;
  /**
   * What a typed text must equal to commit an option on its own
   * (`soleExactMatch`). Default: the option's `text`, through `normalise`.
   */
  exact?: ExactMatchOptions<T>;
  limit?: number;
  prefixOnly?: boolean;
  /** Row shown when nothing matches; without one an empty list stays closed. */
  emptyText?: string;
  isSelected?: (option: T) => boolean;
  onPick: (option: T) => void;
}

export interface Combobox {
  /** Re-renders an open list, e.g. once its source has loaded. */
  refresh(): void;
  close(): void;
}

export function createCombobox<T>(config: ComboboxConfig<T>): Combobox {
  const { input, list, toggle, text, sub, normalise, limit, prefixOnly, emptyText, isSelected, onPick } = config;
  const exact: ExactMatchOptions<T> = config.exact ?? {
    keys: (option) => [text(option)],
    key: (value) => (normalise ?? ((q: string) => q))(foldQuery(value)),
  };
  const shell = input.parentElement!;
  let items: T[] = [];
  let active = -1;
  let expanded = false;
  // The list narrows only to what was TYPED since the last pick or blur:
  // reopening a field that holds a settled value shows the whole list again
  // (design); Escape keeps the typed filter for the next ArrowDown.
  let typed = false;
  // The participant asked for the list (typed, clicked, arrowed) and has not
  // dismissed it; a list whose source was still loading opens once it arrives.
  let wanted = false;

  const optionId = (index: number): string => `${list.id}-opt-${index}`;

  const query = (): string => (typed ? input.value : '');

  const labelled = (option: T): DocumentFragment => {
    const fragment = document.createDocumentFragment();
    const label = document.createElement('span');
    const value = text(option);
    const parts = splitHighlight(value, query(), normalise);
    if (parts) {
      const bold = document.createElement('b');
      bold.textContent = parts.match;
      label.append(parts.before, bold, parts.after);
    } else {
      label.textContent = value;
    }
    fragment.append(label);
    const tail = sub?.(option);
    if (tail) {
      const muted = document.createElement('span');
      muted.className = 'ob-signup__opt-sub';
      // A no-break space, not a layout gap: the accessible name and the text
      // read «Кировск — Ленинградская область», and a wrapped tail keeps its dash.
      muted.textContent = `\u00a0— ${tail}`;
      fragment.append(muted);
    }
    return fragment;
  };

  const paintActive = (): void => {
    // APG list autocomplete: `aria-selected` marks the active option only, so
    // a screen reader does not say «not selected» on every arrow step. The
    // committed value keeps its own look through `is-selected`.
    list.querySelectorAll<HTMLElement>('[role="option"]').forEach((el, index) => {
      const on = expanded && index === active;
      el.classList.toggle('is-active', on);
      if (on) el.setAttribute('aria-selected', 'true');
      else el.removeAttribute('aria-selected');
    });
    if (expanded && active >= 0) {
      input.setAttribute('aria-activedescendant', optionId(active));
      document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  const setExpanded = (value: boolean): void => {
    expanded = value;
    list.hidden = !value;
    input.setAttribute('aria-expanded', String(value));
    shell.classList.toggle('is-open', value);
    if (!value) active = -1;
    paintActive();
  };

  /** Rebuilds the options; closes instead when there is nothing to show. */
  const render = (): boolean => {
    const matches = filterOptions(config.options(), query(), { text, normalise, limit, prefixOnly });
    const pinned = config.pinned?.() ?? null;
    items = pinned ? [...matches, pinned] : matches;
    if (items.length === 0 || (matches.length === 0 && !pinned && !emptyText)) return false;

    // «Друг» finds nothing among the rest but IS the pinned «Другое»: no
    // «Ничего не найдено» above the one option that answers it.
    const pinnedAnswers = pinned !== null && splitHighlight(text(pinned), query(), normalise) !== null;
    const rows: HTMLElement[] = [];
    if (matches.length === 0 && emptyText && !pinnedAnswers) {
      const empty = document.createElement('li');
      empty.className = 'ob-signup__opt-empty';
      empty.setAttribute('role', 'presentation');
      empty.textContent = emptyText;
      rows.push(empty);
    }
    items.forEach((option, index) => {
      const row = document.createElement('li');
      row.id = optionId(index);
      row.setAttribute('role', 'option');
      row.className = option === pinned ? 'ob-signup__opt ob-signup__opt--pinned' : 'ob-signup__opt';
      row.classList.toggle('is-selected', isSelected?.(option) ?? false);
      row.append(labelled(option));
      rows.push(row);
    });
    list.replaceChildren(...rows);
    return true;
  };

  const open = (activeIndex: number): void => {
    if (!render()) {
      setExpanded(false);
      return;
    }
    active = activeIndex < 0 ? -1 : Math.min(activeIndex, items.length - 1);
    setExpanded(true);
  };

  /** Opens with the current value's option active, if it is listed. */
  const openAtSelection = (): void => {
    open(-1);
    if (!expanded || !isSelected) return;
    const index = items.findIndex((option) => isSelected(option));
    if (index >= 0) {
      active = index;
      paintActive();
    }
  };

  /** Closed by the participant (Escape, Tab, blur, a press elsewhere). */
  const dismiss = (): void => {
    wanted = false;
    setExpanded(false);
  };

  const commit = (option: T): void => {
    dismiss();
    typed = false;
    onPick(option);
  };

  const pick = (index: number): void => {
    const option = items[index];
    if (option !== undefined) commit(option);
  };

  /** The option the typed text names exactly and alone, if any. */
  const exactOption = (): T | null => {
    if (!typed) return null;
    const pinned = config.pinned?.() ?? null;
    const all = pinned ? [...config.options(), pinned] : config.options();
    return soleExactMatch(all, input.value, exact);
  };

  /** Typed text: commits an exact single match, otherwise lists what fits. */
  const settleOrOpen = (): void => {
    const option = exactOption();
    if (option !== null) commit(option);
    else open(0);
  };

  /** Closing without a pick still takes a full, unambiguous name as one. */
  const leave = (): void => {
    const option = exactOption();
    if (option !== null) commit(option);
    else dismiss();
  };

  input.addEventListener('input', () => {
    typed = true;
    wanted = true;
    settleOrOpen();
  });

  input.addEventListener('click', () => {
    wanted = true;
    if (!expanded) openAtSelection();
  });

  input.addEventListener('keydown', (event) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!expanded || event.altKey) {
          wanted = true;
          if (!expanded) openAtSelection();
          return;
        }
        active = moveActive(active, 1, items.length);
        paintActive();
        return;
      case 'ArrowUp':
        if (!expanded) return;
        event.preventDefault();
        active = moveActive(active, -1, items.length);
        paintActive();
        return;
      case 'Enter':
        // A closed list leaves Enter to the form (implicit submission).
        if (!expanded || active < 0) return;
        event.preventDefault();
        pick(active);
        return;
      case 'Escape':
        // Also withdraws a request still waiting for its source to load.
        wanted = false;
        if (!expanded) return;
        event.preventDefault();
        dismiss();
        return;
      case 'Tab':
        leave();
        return;
      default:
    }
  });

  input.addEventListener('blur', () => {
    leave();
    typed = false;
  });

  /** The option row under an event's target, as an index into `items`; -1 off a row. */
  const rowIndex = (target: EventTarget | null): number => {
    if (!(target instanceof Element) || !list.contains(target)) return -1;
    const row = target.closest<HTMLElement>('[role="option"]');
    return row ? Array.prototype.indexOf.call(list.querySelectorAll('[role="option"]'), row) : -1;
  };

  // An option press must not blur the input: the pick happens on click, and a
  // blur in between would run the field's own blur resolution first. A pick
  // needs the press AND the release on the same row of the list as shown — a
  // click whose press began elsewhere, or on a list re-rendered since, picks
  // nothing.
  let pressed = -1;
  list.addEventListener('mousedown', (event) => {
    event.preventDefault();
    pressed = rowIndex(event.target);
  });
  list.addEventListener('click', (event) => {
    const index = rowIndex(event.target);
    const held = pressed;
    pressed = -1;
    if (index >= 0 && index === held) pick(index);
  });
  list.addEventListener('mousemove', (event) => {
    const index = rowIndex(event.target);
    if (index >= 0 && index !== active) {
      active = index;
      paintActive();
    }
  });

  toggle?.addEventListener('mousedown', (event) => {
    event.preventDefault();
    if (expanded) {
      dismiss();
      return;
    }
    wanted = true;
    input.focus();
    openAtSelection();
  });

  // A press anywhere else closes the list, focus or not (the input may keep
  // the focus through a press on a non-focusable part of the page).
  document.addEventListener('pointerdown', (event) => {
    if (expanded && !shell.contains(event.target as Node)) leave();
  });

  return {
    refresh() {
      if (!wanted || document.activeElement !== input) return;
      if (expanded) open(active);
      else if (typed) settleOrOpen();
      else openAtSelection();
    },
    close: dismiss,
  };
}
