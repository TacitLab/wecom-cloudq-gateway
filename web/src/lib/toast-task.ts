import { toast } from 'sonner'

/** 统一的异步任务提示：loading toast 原地变为 success/error 结果 */
export function toastTask<T>(
  task: Promise<T>,
  loading: string,
  success: string | ((result: T) => string),
): Promise<T> {
  toast.promise(task, {
    loading,
    success: typeof success === 'function' ? success : () => success,
    error: (e) => (e instanceof Error ? e.message : String(e)),
  })
  return task
}
