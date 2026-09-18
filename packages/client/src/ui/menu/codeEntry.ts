/**
 * 방 코드 입력칸.
 *
 * 코드는 말로 불러 주는 물건이라 소문자·공백·하이픈이 섞여 들어온다.
 * 정규화는 shared의 normalizeRoomCode 하나만 쓴다(알파벳 정의가 거기 있으므로).
 */
import { ROOM_CODE_LENGTH, normalizeRoomCode } from '@gojijeon/shared';
import { el } from '../dom';

export class CodeEntry {
  readonly root = el('div', { class: 'chips' });
  private readonly input = el('input') as HTMLInputElement;

  constructor(onChange: (code: string) => void, onSubmit: () => void) {
    this.input.type = 'text';
    this.input.className = 'clickable code-input';
    this.input.placeholder = '····'.slice(0, ROOM_CODE_LENGTH);
    this.input.maxLength = ROOM_CODE_LENGTH;
    this.input.autocapitalize = 'characters';
    this.input.spellcheck = false;
    this.input.addEventListener('input', () => {
      const clean = normalizeRoomCode(this.input.value);
      // 입력칸 자체를 정규화된 값으로 되돌려야 화면과 상태가 어긋나지 않는다.
      if (this.input.value !== clean) this.input.value = clean;
      onChange(clean);
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') onSubmit();
    });
    this.root.append(this.input);
  }

  update(code: string, enabled: boolean): void {
    if (this.input.value !== code) this.input.value = code;
    this.input.disabled = !enabled;
  }

  focus(): void {
    this.input.focus();
    this.input.select();
  }
}
