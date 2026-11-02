"""평가셋 30문항(예시 코퍼스 기준, 운영 지표 아님). (질문, 적용일, 정답 doc_id)."""

from __future__ import annotations

from datetime import date

OLD = date(2022, 3, 1)
NEW = date(2025, 1, 15)

EVAL_SET: list[tuple[str, date, str]] = [
    # 개정 이력 6문항
    ("일반주거지역 건폐율 상한은 얼마인가", OLD, "law-cov-v1"),
    ("일반주거지역 건폐율 상한은 얼마인가", NEW, "law-cov-v2"),
    ("제2종 일반주거지역 용적률은 몇 퍼센트 이하인가", OLD, "law-far-v1"),
    ("제2종 일반주거지역 용적률은 몇 퍼센트 이하인가", NEW, "law-far-v2"),
    ("전용주거지역 정북방향 일조 높이제한은 얼마나 띄워야 하나", OLD, "law-sun-v1"),
    ("전용주거지역 정북방향 일조 높이제한은 얼마나 띄워야 하나", NEW, "law-sun-v2"),
    # 법령
    ("업무시설 부설주차장은 면적당 몇 대를 설치하나", NEW, "law-park"),
    ("피난계단 설치 대상은 어떤 경우인가", NEW, "law-stair"),
    ("다중이용시설 대지 안의 공지는 몇 미터인가", NEW, "law-open"),
    ("조경 면적은 대지면적의 몇 퍼센트인가", NEW, "law-land"),
    ("승강기 설치 대상 건축물은", NEW, "law-elev"),
    ("방화구획 바닥면적 기준은", NEW, "law-fire"),
    ("관람실 반자높이 기준은", NEW, "law-ceil"),
    ("부설주차장 설치 기준", OLD, "law-park"),
    ("피난계단 거실 바닥면적 합계", OLD, "law-stair"),
    ("조경 대지면적 15퍼센트", OLD, "law-land"),
    # 지구단위계획
    ("한빛지구 건축선 후퇴 거리는", NEW, "dp-line"),
    ("한빛지구 중심상업 최고높이는", NEW, "dp-height"),
    ("한빛지구 1층 가로변에 허용하지 않는 용도는", NEW, "dp-use"),
    ("한빛지구 외벽 마감재료와 반사유리 비율", NEW, "dp-mat"),
    ("한빛지구 차량 출입구 위치", NEW, "dp-gate"),
    ("한빛지구 건축선 도로경계선 후퇴", OLD, "dp-line"),
    # 질의회신
    ("발코니를 확장하면 용적률에 포함되나", NEW, "rp-balcony"),
    ("필로티 주차장 바닥면적 산입 여부", NEW, "rp-pilotis"),
    ("지하층은 어떻게 판단하나", NEW, "rp-basement"),
    ("가설건축물 존치기간은 몇 년인가", NEW, "rp-temp"),
    ("증축할 때 승강기 설치 면적은 용적률에서 제외되나", NEW, "rp-extend"),
    ("발코니 확장 바닥면적 산정", OLD, "rp-balcony"),
    ("필로티 벽이 없는 부분", OLD, "rp-pilotis"),
    ("지하층 평균 높이 2분의 1", OLD, "rp-basement"),
]
