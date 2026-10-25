# 一级标题 Heading 1

## 二级标题 Heading 2

### 三级标题 Heading 3

#### 四级标题 Heading 4

##### 五级标题 Heading 5

###### 六级标题 Heading 6

## 结尾带井号的标题 ##

Setext 一级标题
===

Setext 二级标题
---

## 行内格式

普通段落里有 **粗体**、__下划线粗体__、*斜体*、_下划线斜体_、***粗斜体***、~~删除线~~ 和 `行内代码`。

嵌套：**粗体里有 *斜体* 和 `代码`**，*斜体里有 **粗体***。

带反引号的代码：`` 代码里有 ` 反引号 ``。

转义字符：\*不是斜体\*、\# 不是标题、\`不是代码\`。

snake_case_word 里的下划线不应被当成强调。

这一行末尾有两个空格，形成硬换行  
这是硬换行后的下一行。

## 链接与图片

行内链接 [Ink 官网](https://example.com/ink) 与带标题的 [链接](https://example.com "标题")。

自动链接 <https://example.com> 与裸链接 https://example.com/plain 。

引用式链接 [参考链接][ref] 。

[ref]: https://example.com/ref

图片 ![替代文字](assets/photo.png)

## 列表

- 无序列表一
- 无序列表二
  - 嵌套二级
    - 嵌套三级
- 无序列表三

* 星号列表
+ 加号列表

1. 有序列表一
2. 有序列表二
   1. 嵌套有序
3. 有序列表三

1) 括号序号

- [ ] 未完成任务
- [x] 已完成任务
- [ ] 任务里有 **粗体** 和 `代码`

## 引用

> 一层引用，里面有 **粗体**。
>
> > 二层引用
>
> - 引用里的列表

## 代码块

```ts
// 带语言的围栏代码块
export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}
```

~~~
波浪线围栏，里面的 **粗体** 和 # 标题 都不应被渲染
~~~

    缩进代码块（四个空格）
    第二行

## 表格

| 左对齐 | 居中 | 右对齐 |
|:---|:---:|---:|
| **粗体** | `代码` | 123 |
| 中文 | English | 4.56 |

## 分隔线

上面是段落。

---

***

___

## HTML 与其他

<details>
<summary>HTML 块</summary>
里面的内容
</details>

行内 HTML：<kbd>⌘</kbd> + <kbd>K</kbd>

中英混排：Ink 是一款 Markdown 写作软件，支持 macOS 10.15+。

最后一段，没有结尾空行。
