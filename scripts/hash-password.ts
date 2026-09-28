/**
 * 운영자 비밀번호 해시 생성: npm run hash-password -- "비밀번호"
 * 출력된 값을 ADMIN_PASSWORD_HASH Secret에 넣으세요. 비밀번호 원문은 어디에도 저장하지 마세요.
 */
import bcrypt from "bcryptjs";

const pw = process.argv[2];
if (!pw || pw.length < 12) {
  console.error("12자 이상 비밀번호를 인수로 주세요: npm run hash-password -- \"비밀번호\"");
  process.exit(1);
}
console.log(bcrypt.hashSync(pw, 12));
