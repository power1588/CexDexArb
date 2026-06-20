export function createRenderScheduler(
  render,
  requestFrame = requestAnimationFrame,
  shouldDefer = () => false,
) {
  let scheduled = false;

  function flush() {
    if (shouldDefer()) {
      requestFrame(flush);
      return;
    }

    scheduled = false;
    render();
  }

  return () => {
    if (scheduled) {
      return;
    }

    scheduled = true;
    requestFrame(flush);
  };
}
