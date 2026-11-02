"""예시 코퍼스. 전부 손으로 만든 가상 조문이며 실제 법령·고시·회신의 원문이 아니다(synthetic=True).

숫자·기준은 시험용 값이다. 운영 색인은 D-14(국가법령정보 DRF 이용 조건) 확인 뒤 실제 수집기로 대체한다.
"""

from __future__ import annotations

from datetime import date

from app.ai.products.arch.ingest.pipeline import SourceDocument

MARK = "[가상 조문·예시 데이터] "
D1 = date(2020, 1, 1)
D2 = date(2024, 7, 1)


def _doc(doc_id: str, kind: str, title: str, text: str, start: date, end: date | None = None) -> SourceDocument:
    return SourceDocument(
        doc_id=doc_id,
        kind=kind,  # type: ignore[arg-type]
        title=title,
        text=MARK + text,
        effective_from=start,
        effective_to=end,
        synthetic=True,
    )


EXAMPLE_DOCS: list[SourceDocument] = [
    _doc("law-cov-v1", "law", "가상건축법 건폐율", "일반주거지역의 건폐율은 100분의 60 이하로 한다.", D1, D2),
    _doc("law-cov-v2", "law", "가상건축법 건폐율", "일반주거지역의 건폐율은 100분의 50 이하로 한다.", D2),
    _doc("law-far-v1", "law", "가상건축법 용적률", "제2종 일반주거지역의 용적률은 200퍼센트 이하로 한다.", D1, D2),
    _doc("law-far-v2", "law", "가상건축법 용적률", "제2종 일반주거지역의 용적률은 230퍼센트 이하로 한다.", D2),
    _doc(
        "law-sun-v1",
        "law",
        "가상건축법 일조 높이제한",
        "전용주거지역에서 정북방향 인접대지 경계선으로부터 높이 9미터 이하 부분은 1.5미터 이상 띄운다.",
        D1,
        D2,
    ),
    _doc(
        "law-sun-v2",
        "law",
        "가상건축법 일조 높이제한",
        "전용주거지역에서 정북방향 인접대지 경계선으로부터 높이 10미터 이하 부분은 1.5미터 이상 띄운다.",
        D2,
    ),
    _doc(
        "law-park",
        "law",
        "가상주차장법 부설주차장",
        "업무시설은 시설면적 150제곱미터당 1대의 부설주차장을 설치한다.",
        D1,
    ),
    _doc(
        "law-stair",
        "law",
        "가상건축법 피난계단",
        "5층 이상 층으로 거실 바닥면적 합계가 200제곱미터를 넘으면 피난계단을 설치한다.",
        D1,
    ),
    _doc(
        "law-open", "law", "가상건축법 대지 안의 공지", "다중이용시설은 건축선으로부터 3미터 이상 공지를 확보한다.", D1
    ),
    _doc(
        "law-land",
        "law",
        "가상건축법 조경",
        "대지면적 200제곱미터 이상인 건축물은 대지면적의 15퍼센트 이상을 조경으로 한다.",
        D1,
    ),
    _doc(
        "law-elev",
        "law",
        "가상건축법 승강기",
        "6층 이상으로 연면적 2000제곱미터 이상인 건축물은 승강기를 설치한다.",
        D1,
    ),
    _doc(
        "law-fire",
        "law",
        "가상건축법 방화구획",
        "주요구조부가 내화구조인 건축물은 바닥면적 1000제곱미터 이내마다 방화구획을 한다.",
        D1,
    ),
    _doc(
        "law-ceil", "law", "가상건축법 거실 반자높이", "문화 및 집회시설의 관람실 반자높이는 4미터 이상으로 한다.", D1
    ),
    _doc(
        "dp-line",
        "district_plan",
        "가상 한빛지구 지구단위계획 건축선",
        "한빛지구 가로변 필지는 건축선을 도로경계선에서 2미터 후퇴한다.",
        D1,
    ),
    _doc(
        "dp-height",
        "district_plan",
        "가상 한빛지구 지구단위계획 높이",
        "한빛지구 중심상업 획지의 최고높이는 45미터로 제한한다.",
        D1,
    ),
    _doc(
        "dp-use",
        "district_plan",
        "가상 한빛지구 지구단위계획 용도",
        "한빛지구 1층 가로변에는 숙박시설과 위락시설을 허용하지 않는다.",
        D1,
    ),
    _doc(
        "dp-mat",
        "district_plan",
        "가상 한빛지구 지구단위계획 외벽재료",
        "한빛지구 건물 외벽은 석재와 벽돌 계열 마감을 권장하고 반사유리 비율을 30퍼센트 이하로 한다.",
        D1,
    ),
    _doc(
        "dp-gate",
        "district_plan",
        "가상 한빛지구 지구단위계획 차량출입",
        "한빛지구 차량 출입구는 보행주출입구 반대편 이면도로에 둔다.",
        D1,
    ),
    _doc(
        "rp-balcony",
        "reply",
        "가상 질의회신 발코니 확장",
        "발코니를 거실로 확장한 부분은 바닥면적과 용적률 산정에 포함된다고 본다.",
        D1,
    ),
    _doc(
        "rp-pilotis",
        "reply",
        "가상 질의회신 필로티 주차장",
        "필로티 구조의 주차장은 벽이 없는 부분의 바닥면적을 산입하지 않는다고 본다.",
        D1,
    ),
    _doc(
        "rp-basement",
        "reply",
        "가상 질의회신 지하층 판단",
        "지표면 아래로 평균 높이의 2분의 1 이상 묻힌 층을 지하층으로 본다.",
        D1,
    ),
    _doc(
        "rp-temp",
        "reply",
        "가상 질의회신 가설건축물 존치기간",
        "공사용 가설건축물의 존치기간은 3년 이내로 신고한다고 본다.",
        D1,
    ),
    _doc(
        "rp-extend",
        "reply",
        "가상 질의회신 증축 완화",
        "기존 건축물의 증축 시 승강기 설치 면적은 용적률 산정에서 제외한다고 본다.",
        D1,
    ),
]
