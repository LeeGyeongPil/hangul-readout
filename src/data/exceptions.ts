/** Irregular readings that cannot be derived from the digits. */

/** Months with a fixed spoken form: 6월 -> 유월, 10월 -> 시월. */
export const MONTH_EXCEPTIONS: Readonly<Record<number, string>> = {
  6: "유월",
  10: "시월",
};

/** "2~3명" style ranges with a fixed native form (key: "a-b"). */
export const RANGE_PAIRS: Readonly<Record<string, string>> = {
  "1-2": "한두",
  "2-3": "두세",
  "3-4": "서너",
  "4-5": "네댓",
  "5-6": "대여섯",
  "6-7": "예닐곱",
};

/**
 * Words that, right after "N번", mean N is a label (Sino-Korean "삼 번 출구")
 * and not a count ("세 번 눌러").
 */
export const BEON_NUMBER_HINTS: readonly string[] = [
  "출구", "버스", "선", "게이트", "트랙", "승강장", "홈", "문제", "채널", "방", "국도", "타자", "라인",
];

/** Words right before "N번" that mark it as a label: "2호선 3번", "번호는 3번". */
export const BEON_PRECEDING_HINTS: readonly string[] = ["호선", "번호는", "번호가", "정답은"];
