import { getSession } from '@/lib/auth';

type Filter = { column: string; operator: 'eq' | 'in'; value: unknown };
type ApiResult = { data: any; error: { message: string } | null };
type Operation = 'query' | 'insert' | 'update' | 'delete';

export function workerApiUrl(path: string) {
  const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL
    || (typeof window !== 'undefined' ? window.location.origin : '');
  if (!baseUrl) throw new Error('EXPO_PUBLIC_API_BASE_URL belum dikonfigurasi untuk aplikasi native.');
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

class WorkerQuery implements PromiseLike<ApiResult> {
  private operation: Operation = 'query';
  private selection = '*';
  private values: unknown;
  private readonly filters: Filter[] = [];
  private orderBy?: { column: string; ascending: boolean };
  private returnSingle = false;

  constructor(private readonly table: string) {}

  select(selection = '*') {
    this.selection = selection;
    return this;
  }

  insert(values: unknown) {
    this.operation = 'insert';
    this.values = values;
    return this;
  }

  update(values: unknown) {
    this.operation = 'update';
    this.values = values;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, operator: 'eq', value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ column, operator: 'in', value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: options?.ascending ?? true };
    return this;
  }

  single() {
    this.returnSingle = true;
    return this;
  }

  private async execute(): Promise<ApiResult> {
    const session = getSession();
    if (!session?.token) return { data: null, error: { message: 'Sesi login tidak valid. Silakan login ulang.' } };

    try {
      const response = await fetch(workerApiUrl(`/api/data/${this.operation}`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          table: this.table,
          select: this.selection,
          filters: this.filters,
          order: this.orderBy,
          single: this.returnSingle,
          values: this.values,
        }),
      });
      const result = await response.json().catch(() => null) as { data?: unknown; error?: string } | null;
      if (!response.ok) return { data: null, error: { message: result?.error ?? `Worker mengembalikan status ${response.status}.` } };
      return { data: result?.data ?? null, error: null };
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : 'Gagal menghubungi Worker.' } };
    }
  }

  then<TResult1 = ApiResult, TResult2 = never>(
    onfulfilled?: ((value: ApiResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

export const supabase = {
  from: (table: string) => new WorkerQuery(table),
};
