export function isEditing(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')
  );
}

export function digit(event: KeyboardEvent): number {
  return /^(Digit|Numpad)[1-9]$/.test(event.code)
    ? Number(event.code.slice(-1))
    : Number(event.key);
}
