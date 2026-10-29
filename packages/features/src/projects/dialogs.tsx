// /projects 대화상자: 새 프로젝트·이름 바꾸기·삭제 확인·저장 충돌(2선택). ui Dialog(네이티브 <dialog>, 포커스 가둠·Esc).
// 입력 검증은 new-project.ts(순수), 문구는 messages.ts. 저장 호출은 index.tsx가 한다(여기는 값만 올린다).
import { Banner, Button, Dialog, Field, Input, Select } from "@arch-studio/ui";
import { useId, useState, type FormEvent } from "react";
import { TEXT } from "./messages.ts";
import { EMPTY_FORM, NAME_MAX_CHARS, USE_DISTRICTS, validateName, validateNewProject, type FormErrors, type NewProjectForm, type NewProjectValues } from "./new-project.ts";

export function NewProjectDialog({
  open,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: NewProjectValues) => void;
}) {
  const id = useId();
  const [form, setForm] = useState<NewProjectForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  // 값은 이벤트 처리 중에 읽는다(갱신 함수 안에서는 currentTarget이 이미 null).
  const set = (k: keyof NewProjectForm) => (e: { currentTarget: { value: string } }) => {
    const value = e.currentTarget.value;
    setForm((f) => ({ ...f, [k]: value }));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = validateNewProject(form);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    onSubmit(r.values);
  };
  const close = () => {
    setForm(EMPTY_FORM);
    setErrors({});
    onClose();
  };
  const describedBy = (k: keyof NewProjectForm) => (errors[k] ? `${id}-${k}-error` : `${id}-${k}-hint`);
  return (
    <Dialog
      open={open}
      onClose={close}
      title={TEXT.newProject}
      description="이름과 대지 정보만 넣으면 이 PC에 새 프로젝트를 만듭니다. 대지 경계는 대지 탭에서 고칩니다."
      footer={
        <>
          <Button onClick={close}>취소</Button>
          <Button variant="primary" type="submit" form={`${id}-form`} loading={busy}>
            만들기
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} noValidate onSubmit={submit} className="flex flex-col gap-gap">
        {error ? <Banner tone="danger" title="만들지 못했습니다">{error}</Banner> : null}
        <Field label="프로젝트 이름" htmlFor={`${id}-name`} hint={`${NAME_MAX_CHARS}자까지`} {...(errors.name ? { error: errors.name } : {})}>
          <Input id={`${id}-name`} value={form.name} onChange={set("name")} required autoComplete="off" invalid={!!errors.name} aria-describedby={describedBy("name")} />
        </Field>
        <Field label="대지 이름(주소·지번, 선택)" htmlFor={`${id}-siteLabel`} hint="목록에 보이는 이름입니다" {...(errors.siteLabel ? { error: errors.siteLabel } : {})}>
          <Input id={`${id}-siteLabel`} value={form.siteLabel} onChange={set("siteLabel")} autoComplete="off" invalid={!!errors.siteLabel} aria-describedby={describedBy("siteLabel")} />
        </Field>
        <Field label="용도지역" htmlFor={`${id}-useDistrict`} hint="판정 기준을 고르는 데 씁니다" {...(errors.useDistrict ? { error: errors.useDistrict } : {})}>
          <Select id={`${id}-useDistrict`} value={form.useDistrict} onChange={set("useDistrict")} required invalid={!!errors.useDistrict} aria-describedby={describedBy("useDistrict")}>
            <option value="">고르세요</option>
            {USE_DISTRICTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-1 gap-gap md:grid-cols-2">
          <Field label="대지 가로" htmlFor={`${id}-widthM`} hint="임시 직사각형 대지" {...(errors.widthM ? { error: errors.widthM } : {})}>
            <Input id={`${id}-widthM`} inputMode="decimal" suffix="m" value={form.widthM} onChange={set("widthM")} required invalid={!!errors.widthM} aria-describedby={describedBy("widthM")} />
          </Field>
          <Field label="대지 세로" htmlFor={`${id}-depthM`} hint="대지 탭에서 실제 경계로 바꿉니다" {...(errors.depthM ? { error: errors.depthM } : {})}>
            <Input id={`${id}-depthM`} inputMode="decimal" suffix="m" value={form.depthM} onChange={set("depthM")} required invalid={!!errors.depthM} aria-describedby={describedBy("depthM")} />
          </Field>
        </div>
      </form>
    </Dialog>
  );
}

export function RenameDialog({
  open,
  initial,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initial: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const id = useId();
  const [name, setName] = useState(initial);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = validateName(name);
    if (problem) {
      setFieldError(problem);
      return;
    }
    setFieldError(null);
    onSubmit(name.trim());
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="이름 바꾸기"
      description="새 이름은 새 버전으로 저장됩니다."
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" type="submit" form={`${id}-form`} loading={busy}>
            저장
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} noValidate onSubmit={submit} className="flex flex-col gap-gap">
        {error ? <Banner tone="danger" title="저장하지 못했습니다">{error}</Banner> : null}
        <Field label="프로젝트 이름" htmlFor={`${id}-name`} hint={`${NAME_MAX_CHARS}자까지`} {...(fieldError ? { error: fieldError } : {})}>
          <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.currentTarget.value)} autoComplete="off" invalid={!!fieldError} />
        </Field>
      </form>
    </Dialog>
  );
}

export function DeleteDialog({
  open,
  name,
  version,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  name: string;
  version: number;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={TEXT.deleteTitle}
      description={TEXT.deleteBody}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="danger" loading={busy} onClick={onConfirm}>
            삭제
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-gap">
        {error ? <Banner tone="danger" title="삭제하지 못했습니다">{error}</Banner> : null}
        <p className="text-body text-fg">
          <span className="font-semibold">{name}</span> <span className="text-fg-2">· 지금 버전 v{version}</span>
        </p>
        <p className="text-caption text-fg-2">목록에서 본 뒤 다른 곳에서 저장되었다면 삭제하지 않고 알립니다.</p>
      </div>
    </Dialog>
  );
}

/**
 * 저장 충돌(VERSION_CONFLICT·AR041) 대화상자 골격: 두 선택만(ADR-001 3장, 03장 5.2절). "두 버전 비교" 화면은 없다.
 * kind=cloud면 "서버 최신 열기", local이면 "저장된 최신 열기"(로컬 저장소에 서버가 없어서 이름만 바꾼다).
 */
export function ConflictDialog({
  open,
  kind,
  name,
  busy,
  error,
  onClose,
  onSaveCopy,
  onOpenLatest,
}: {
  open: boolean;
  kind: "local" | "cloud";
  name: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSaveCopy: () => void;
  onOpenLatest: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={TEXT.conflictTitle}
      description={TEXT.conflictBody}
      footer={
        <>
          <Button onClick={onOpenLatest} disabled={busy}>
            {kind === "cloud" ? TEXT.conflictLatestCloud : TEXT.conflictLatestLocal}
          </Button>
          <Button variant="primary" loading={busy} onClick={onSaveCopy}>
            {TEXT.conflictCopy}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-gap">
        {error ? <Banner tone="danger" title="저장하지 못했습니다">{error}</Banner> : null}
        <p className="text-body text-fg">
          <span className="font-semibold">{name}</span>
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-caption text-fg-2">
          <li>{TEXT.conflictCopy}: 내 변경을 새 프로젝트 "{name} (내 변경)"으로 저장합니다. 원래 프로젝트는 그대로입니다.</li>
          <li>
            {kind === "cloud" ? TEXT.conflictLatestCloud : TEXT.conflictLatestLocal}: {TEXT.conflictLatestWarn}
          </li>
        </ul>
      </div>
    </Dialog>
  );
}
