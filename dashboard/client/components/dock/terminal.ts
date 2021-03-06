import debounce from "lodash/debounce";
import { autorun } from "mobx";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { dockStore, TabId } from "./dock.store";
import { TerminalApi } from "../../api/terminal-api";
import { themeStore } from "../../theme.store";
import { autobind } from "../../utils";

export class Terminal {
  static spawningPool: HTMLElement;

  static init() {
    // terminal element must be in DOM before attaching via xterm.open(elem)
    // https://xtermjs.org/docs/api/terminal/classes/terminal/#open
    const pool = document.createElement("div");
    pool.className = "terminal-init";
    pool.style.cssText = "position: absolute; top: 0; left: 0; height: 0; visibility: hidden; overflow: hidden"
    document.body.appendChild(pool);
    Terminal.spawningPool = pool;
  }

  public xterm: XTerm;
  public fitAddon: FitAddon;
  public scrollPos = 0;
  public disposers: Function[] = [];

  @autobind()
  protected setTheme(colors = themeStore.activeTheme.colors) {
    // Replacing keys stored in styles to format accepted by terminal
    // E.g. terminalBrightBlack -> brightBlack
    const colorPrefix = "terminal"
    const terminalColors = Object.entries(colors)
      .filter(([name]) => name.startsWith(colorPrefix))
      .reduce<any>((colors, [name, color]) => {
        const colorName = name.split("").slice(colorPrefix.length);
        colorName[0] = colorName[0].toLowerCase();
        colors[colorName.join("")] = color;
        return colors;
      }, {});
    this.xterm.setOption("theme", terminalColors);
  }

  get elem() {
    return this.xterm.element;
  }

  get viewport() {
    return this.xterm.element.querySelector(".xterm-viewport");
  }

  constructor(public tabId: TabId, protected api: TerminalApi) {
    this.init();
  }

  get isActive() {
    const { isOpen, selectedTabId } = dockStore;
    return isOpen && selectedTabId === this.tabId;
  }

  attachTo(parentElem: HTMLElement) {
    parentElem.appendChild(this.elem);
    this.onActivate();
  }

  detach() {
    Terminal.spawningPool.appendChild(this.elem);
  }

  init() {
    if (this.xterm) {
      return;
    }
    this.xterm = new XTerm({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 13,
      fontFamily: "RobotoMono"
    });

    // enable terminal addons
    this.fitAddon = new FitAddon();
    this.xterm.loadAddon(this.fitAddon);

    this.xterm.open(Terminal.spawningPool);
    this.xterm.registerLinkMatcher(/https?:\/\/[^\s]+/i, this.onClickLink);
    this.xterm.attachCustomKeyEventHandler(this.keyHandler);

    // bind events
    const onResizeDisposer = dockStore.onResize(this.onResize);
    const onData = this.xterm.onData(this.onData);
    const onThemeChangeDisposer = autorun(() => this.setTheme(themeStore.activeTheme.colors));
    this.viewport.addEventListener("scroll", this.onScroll);
    this.api.onReady.addListener(this.onClear, { once: true }); // clear status logs (connecting..)
    this.api.onData.addListener(this.onApiData);
    window.addEventListener("resize", this.onResize);

    // add clean-up handlers to be called on destroy
    this.disposers.push(
      onResizeDisposer,
      onThemeChangeDisposer,
      () => onData.dispose(),
      () => this.fitAddon.dispose(),
      () => this.api.removeAllListeners(),
      () => window.removeEventListener("resize", this.onResize),
    );
  }

  destroy() {
    if (!this.xterm) return;
    this.disposers.forEach(dispose => dispose());
    this.disposers = [];
    this.xterm.dispose();
    this.xterm = null;
  }

  fit = () => {
    this.fitAddon.fit();
    const { cols, rows } = this.xterm;
    this.api.sendTerminalSize(cols, rows);
  };

  fitLazy = debounce(this.fit, 250);

  focus = () => {
    this.xterm.focus();
  }

  onApiData = (data: string) => {
    this.xterm.write(data);
  }

  onData = (data: string) => {
    if (!this.api.isReady) return;
    this.api.sendCommand(data);
  }

  onScroll = () => {
    this.scrollPos = this.viewport.scrollTop;
  }

  onClear = () => {
    this.xterm.clear();
  }

  onResize = () => {
    if (!this.isActive) return;
    this.fitLazy();
  }

  onActivate = () => {
    this.fit();
    setTimeout(() => this.focus(), 250); // delay used to prevent focus on active tab
    this.viewport.scrollTop = this.scrollPos; // restore last scroll position
  }

  onClickLink = (evt: MouseEvent, link: string) => {
    window.open(link, "_blank");
  }

  keyHandler = (evt: KeyboardEvent): boolean => {
    const { code, ctrlKey, type } = evt;

    // Handle custom hotkey bindings
    if (ctrlKey) {
      switch (code) {
      // Ctrl+C: prevent terminal exit on windows / linux (?)
      case "KeyC":
        if (this.xterm.hasSelection()) return false;
        break;

        // Ctrl+W: prevent unexpected terminal tab closing, e.g. editing file in vim
        // https://github.com/kontena/lens-app/issues/156#issuecomment-534906480
      case "KeyW":
        evt.preventDefault();
        break;
      }
    }

    // Pass the event above in DOM for <Dock/> to handle common actions
    if (!evt.defaultPrevented) {
      this.elem.dispatchEvent(new KeyboardEvent(type, evt));
    }

    return true;
  }
}

Terminal.init();