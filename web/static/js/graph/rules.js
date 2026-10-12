// Placeholder subview; implemented in a later layer.
export function createSubview(api) {
  api.stage.innerHTML = '<p class="empty">The rules graph is coming in a later layer.</p>';
  return {update() {}};
}
