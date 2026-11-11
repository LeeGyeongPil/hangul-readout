/**
 * Counters (suryangsa). The counter after a number decides which number system is read:
 * native Korean ("세 개") or Sino-Korean ("삼 년").
 * Facts only (general Korean grammar); the lists are written by hand.
 */

/** Counters read with native Korean numerals: 3개 -> 세 개. */
export const NATIVE_COUNTERS: readonly string[] = [
  "개", "명", "살", "마리", "권", "병", "잔", "대", "장", "가지", "군데", "사람", "송이",
  "켤레", "벌", "채", "그루", "시간", "달", "곡", "척", "통", "알", "쌍", "컵", "그릇",
  "접시", "줄", "곳", "자루", "봉지", "조각", "방울", "모금", "바퀴", "자리", "포기", "캔",
];

/** Counters read with Sino-Korean numerals: 3년 -> 삼 년. */
export const SINO_COUNTERS: readonly string[] = [
  "년", "개월", "주", "주년", "일", "일차", "분", "초", "원", "층", "호", "호선", "번지",
  "회", "학년", "학기", "분기", "세", "위", "등", "등급", "점", "인분", "차", "부", "기",
  "건", "쪽", "페이지", "화", "편", "달러", "엔", "위안", "동", "도", "배", "교시", "강",
];
