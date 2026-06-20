import {
  applyViewportMode,
  getViewportMode,
  getViewportModeLabel,
} from "../../src/utils/responsive.js";

describe("responsive", () => {
  it("根据宽度推导布局模式", () => {
    expect(getViewportMode(1440)).toBe("desktop");
    expect(getViewportMode(1024)).toBe("tablet");
    expect(getViewportMode(640)).toBe("mobile");
  });

  it("将布局模式同步到目标元素 dataset", () => {
    const target = document.createElement("div");
    const mode = applyViewportMode(target, 900);

    expect(mode).toBe("tablet");
    expect(target.dataset.viewportMode).toBe("tablet");
  });

  it("提供布局模式中文标签", () => {
    expect(getViewportModeLabel("desktop")).toBe("桌面布局");
    expect(getViewportModeLabel("mobile")).toBe("移动布局");
  });
});
