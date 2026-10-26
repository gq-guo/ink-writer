/**
 * 主界面画出来之后，收回 theme-boot.js 铺在 <html> 上的临时底色（见 releaseBootBackground）。
 * 做成组件而不是写在 App 的 effect 里：它随主界面一起挂载，App 还在 return null 的时候不会提前触发。
 */
import { useEffect } from 'react'

import { releaseBootBackground } from '@/stores/settingsStore'

export function BootBackgroundRelease() {
  useEffect(() => {
    // 等这一帧真正画出来再收，避免材质在主界面出现之前露出来
    const frame = requestAnimationFrame(() => releaseBootBackground())
    return () => cancelAnimationFrame(frame)
  }, [])
  return null
}
