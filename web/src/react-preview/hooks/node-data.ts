import { useEffect, useRef, useState } from "react";
import { apiRequest, RequestError, UnauthorizedError } from "../lib/api";
import type {
  NodeDetail,
  NodeHistoryChangeEventPage,
  NodeHistoryEntry,
  NodeHistoryFieldOptionList,
  NodeHistoryListResponse,
  PublicNodeDetail
} from "../lib/types";

export function useNodePageData(uuid: string, targetID: number | null, onUnauthorized: () => void) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const detailRef = useRef<NodeDetail | null>(null);

  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!uuid) {
        setError("节点不存在");
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const currentDetail = detailRef.current;
      const refreshInPlace = currentDetail !== null && currentDetail.komari_node_uuid === uuid;
      if (refreshInPlace) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError("");
      setErrorStatus(null);

      try {
        const query = new URLSearchParams();
        if (targetID) {
          query.set("target_id", String(targetID));
        }
        const detailPath = `/nodes/${uuid}${query.size > 0 ? `?${query.toString()}` : ""}`;
        const detailResponse = await apiRequest<NodeDetail>(detailPath);

        if (cancelled) {
          return;
        }

        setDetail(detailResponse);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        if (loadError instanceof UnauthorizedError) {
          onUnauthorized();
          return;
        }
        if (loadError instanceof RequestError) {
          setErrorStatus(loadError.status);
        }
        const activeDetail = detailRef.current;
        if (!activeDetail || activeDetail.komari_node_uuid !== uuid) {
          setError(loadError instanceof Error ? loadError.message : "加载节点详情失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [onUnauthorized, reloadToken, targetID, uuid]);

  return {
    loading,
    refreshing,
    error,
    errorStatus,
    detail,
    reload: () => setReloadToken((value) => value + 1)
  };
}

export function useAllNodeHistoryData(
  uuid: string,
  targetID: number | null,
  onUnauthorized: () => void,
  options?: { startDate?: string; endDate?: string }
) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<NodeHistoryEntry[]>([]);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!uuid) {
        setError("节点不存在");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const pageSize = 100;
        let page = 1;
        let totalPages = 1;
        const collected: NodeHistoryEntry[] = [];

        while (page <= totalPages) {
          const query = new URLSearchParams();
          if (targetID) {
            query.set("target_id", String(targetID));
          }
          query.set("page", String(page));
          query.set("page_size", String(pageSize));
          if (options?.startDate?.trim()) {
            query.set("start_date", options.startDate.trim());
          }
          if (options?.endDate?.trim()) {
            query.set("end_date", options.endDate.trim());
          }
          const response = await apiRequest<NodeHistoryListResponse>(
            `/nodes/${uuid}/history${query.size > 0 ? `?${query.toString()}` : ""}`
          );
          if (cancelled) {
            return;
          }
          collected.push(...(response.items ?? []));
          totalPages = response.total_pages ?? 0;
          if (totalPages <= 0) {
            break;
          }
          page += 1;
        }

        if (cancelled) {
          return;
        }

        setItems(collected);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        if (loadError instanceof UnauthorizedError) {
          onUnauthorized();
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载历史记录失败");
        setItems([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [onUnauthorized, options?.endDate, options?.startDate, reloadToken, targetID, uuid]);

  return {
    loading,
    error,
    items,
    reload: () => setReloadToken((value) => value + 1)
  };
}

export function useNodeHistoryEvents(
  uuid: string,
  targetID: number | null,
  fieldID: string,
  onUnauthorized: () => void,
  options?: { page?: number; pageSize?: number; startDate?: string; endDate?: string }
) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<NodeHistoryChangeEventPage["items"]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(options?.pageSize ?? 10);
  const [totalPages, setTotalPages] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!uuid) {
        setError("节点不存在");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const query = new URLSearchParams();
        if (targetID) {
          query.set("target_id", String(targetID));
        }
        if (fieldID.trim()) {
          query.set("field", fieldID.trim());
        }
        query.set("page", String(options?.page && options.page > 0 ? options.page : 1));
        query.set("page_size", String(options?.pageSize && options.pageSize > 0 ? options.pageSize : 10));
        if (options?.startDate?.trim()) {
          query.set("start_date", options.startDate.trim());
        }
        if (options?.endDate?.trim()) {
          query.set("end_date", options.endDate.trim());
        }
        const response = await apiRequest<NodeHistoryChangeEventPage>(`/nodes/${uuid}/history/events?${query.toString()}`);
        if (cancelled) {
          return;
        }
        setItems(response.items ?? []);
        setTotal(response.total ?? 0);
        setPage(response.page ?? 1);
        setPageSize(response.page_size ?? (options?.pageSize ?? 10));
        setTotalPages(response.total_pages ?? 0);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        if (loadError instanceof UnauthorizedError) {
          onUnauthorized();
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载历史变化失败");
        setItems([]);
        setTotal(0);
        setPage(1);
        setTotalPages(0);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [fieldID, onUnauthorized, options?.endDate, options?.page, options?.pageSize, options?.startDate, reloadToken, targetID, uuid]);

  return {
    loading,
    error,
    items,
    total,
    page,
    pageSize,
    totalPages,
    reload: () => setReloadToken((value) => value + 1)
  };
}

export function useNodeHistoryFieldOptions(
  uuid: string,
  targetID: number | null,
  onUnauthorized: () => void,
  options?: { startDate?: string; endDate?: string }
) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<Array<{ id: string; label: string }>>([]);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!uuid) {
        setError("节点不存在");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const query = new URLSearchParams();
        if (targetID) {
          query.set("target_id", String(targetID));
        }
        if (options?.startDate?.trim()) {
          query.set("start_date", options.startDate.trim());
        }
        if (options?.endDate?.trim()) {
          query.set("end_date", options.endDate.trim());
        }
        const response = await apiRequest<NodeHistoryFieldOptionList>(`/nodes/${uuid}/history/fields?${query.toString()}`);
        if (cancelled) {
          return;
        }
        setItems(response.items ?? []);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        if (loadError instanceof UnauthorizedError) {
          onUnauthorized();
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载字段筛选失败");
        setItems([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [onUnauthorized, options?.endDate, options?.startDate, reloadToken, targetID, uuid]);

  return {
    loading,
    error,
    items,
    reload: () => setReloadToken((value) => value + 1)
  };
}

export function usePublicNodePageData(uuid: string, targetID: number | null, displayIP: string) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [detail, setDetail] = useState<PublicNodeDetail | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!uuid) {
        setError("节点不存在");
        setErrorStatus(404);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");
      setErrorStatus(null);

      try {
        const query = new URLSearchParams();
        if (targetID) {
          query.set("target_id", String(targetID));
        }
        if (displayIP.trim()) {
          query.set("display_ip", displayIP.trim());
        }
        const detailResponse = await apiRequest<PublicNodeDetail>(
          `/public/nodes/${uuid}/current${query.size > 0 ? `?${query.toString()}` : ""}`
        );

        if (cancelled) {
          return;
        }

        setDetail(detailResponse);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        if (loadError instanceof RequestError) {
          setErrorStatus(loadError.status);
        }
        setError(loadError instanceof Error ? loadError.message : "加载节点详情失败");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [displayIP, reloadToken, targetID, uuid]);

  return {
    loading,
    error,
    errorStatus,
    detail,
    reload: () => setReloadToken((value) => value + 1)
  };
}
