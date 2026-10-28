//! 关掉 macOS 的「智能破折号」「智能引号」。
//!
//! WKWebView 的可编辑区默认跟随系统设置：输入 `--` 会被换成 `—`，`"` 换成 `“ ”`。
//! 对 Markdown 这是改写源码：`---厉害---` 存下来变成 `—厉害---`，代码里的引号也会被换掉。
//! 前端 contentDOM 的 autocorrect="off" 管不到这两项，只能在 WebKit 读设置之前，
//! 往本应用的偏好里写它认的两个键（WebKit 的 TextChecker 先看这两个键，没有才跟随系统）。
//! 只影响本应用；文本替换（系统设置里的「替换」短语）不动。

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::{c_char, c_void, CStr};

    type CFTypeRef = *const c_void;

    const UTF8: u32 = 0x0800_0100;

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        static kCFBooleanFalse: CFTypeRef;
        static kCFPreferencesCurrentApplication: CFTypeRef;
        fn CFStringCreateWithCString(alloc: CFTypeRef, c_str: *const c_char, encoding: u32) -> CFTypeRef;
        fn CFPreferencesSetAppValue(key: CFTypeRef, value: CFTypeRef, application: CFTypeRef);
        fn CFRelease(cf: CFTypeRef);
    }

    pub fn disable(keys: &[&CStr]) {
        for key in keys {
            // SAFETY: 只传 CoreFoundation 自己的常量和刚创建的 CFString；用完即释放
            unsafe {
                let cf_key = CFStringCreateWithCString(std::ptr::null(), key.as_ptr(), UTF8);
                if cf_key.is_null() {
                    continue;
                }
                CFPreferencesSetAppValue(cf_key, kCFBooleanFalse, kCFPreferencesCurrentApplication);
                CFRelease(cf_key);
            }
        }
    }
}

/// 在创建任何 WebView 之前调用（WebKit 只在第一次用到时读一次）
pub fn disable_smart_substitutions() {
    #[cfg(target_os = "macos")]
    mac::disable(&[c"WebAutomaticDashSubstitutionEnabled", c"WebAutomaticQuoteSubstitutionEnabled"]);
}
