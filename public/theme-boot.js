/**
 * 首帧前设好 <html data-theme>，避免深色模式下刷新 / 启动时先闪一下浅色。
 *
 * 真正的设置要等 settingsStore.hydrate() 经 Rust 异步读回，那时页面已经按浅色画过一帧了；
 * 这里同步读 settingsStore 缓存的主题偏好（THEME_BOOT_KEY），没有缓存就跟随系统。
 * CSP 是 script-src 'self'，不能写成 index.html 里的内联脚本，所以单独放一个文件。
 *
 * 开发模式下 globals.css 由 Vite 经 JS 注入，样式到之前页面是浏览器默认的白底，
 * 所以这里同时在 <html> 上先铺一层底色（与 globals.css 的 --background 一致，有单测核对），
 * 主界面画出来之后由 releaseBootBackground 收回。
 *
 * macOS App 里主窗口是透明窗口 + sidebar 材质（见 src-tauri/src/window_theme.rs）：
 * 标上 data-vibrancy，样式表据此把侧栏留成半透明。这时也照样铺底色：body 是透明的，
 * 不铺的话主界面渲染出来之前整窗都是灰色材质，刷新时就是一闪。
 * 底色要等主界面画出来才收回（releaseBootBackground），侧栏再淡出成半透明。
 */
;(function () {
  var BACKGROUND = { light: '#faf9f6', dark: '#1b1a18' }
  try {
    var vibrancy = '__TAURI_INTERNALS__' in window && /Mac/.test(navigator.userAgent)
    if (vibrancy) document.documentElement.setAttribute('data-vibrancy', 'true')
    var preference = window.localStorage.getItem('ink:theme')
    var dark =
      preference === 'dark' ||
      (preference !== 'light' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)
    var theme = dark ? 'dark' : 'light'
    var root = document.documentElement
    root.setAttribute('data-theme', theme)
    root.style.backgroundColor = BACKGROUND[theme]
    root.style.colorScheme = theme
  } catch (error) {
    // 读不到缓存就保持 index.html 里的默认值，等 hydrate 纠正
  }
})()
