export const PASSWORD_MIN_LENGTH = 12;

/** bcrypt's byte limit must be enforced before hashing, including Unicode input. */
export function passwordError(password: string): string | null {
  if ([...password].length < PASSWORD_MIN_LENGTH) return `비밀번호를 ${PASSWORD_MIN_LENGTH}자 이상 입력해 주세요.`;
  if (!password.trim()) return "공백만으로는 비밀번호를 만들 수 없습니다.";
  if (new TextEncoder().encode(password).length > 72) return "비밀번호가 너무 깁니다. 한글이 포함되었다면 길이를 줄여 주세요.";
  return null;
}
