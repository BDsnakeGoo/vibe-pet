# VibePet GIF Packs

每个子文件夹是一组可选 GIF。目录名就是设置页下拉框里的组 ID。

`default` 是项目自带默认组，启动时会自动加载。

一组 GIF 必须包含这三个文件：

```text
assets/gif-packs/your-pack-name/
  idle.gif
  working.gif
  waiting.gif
```

`completed.gif` 是可选文件。缺少时，“已完成”状态会复用 `idle.gif`。

缺少 `idle.gif`、`working.gif`、`waiting.gif` 任意一个时，该组不会被加载。
