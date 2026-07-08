package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// TestDebugConcurrentAccess guards against a data race in gopsutil's
// Process.Percent: it tracks the previous CPU-time reading on the *Process
// itself with no internal locking, so unsynchronized concurrent calls (e.g.
// several browser tabs each polling /api/debug on its 2s timer) race on that
// state. Run with `go test -race` to make this test meaningful — without
// the mutex in Debug, the race detector flags the read/write in
// gopsutil's PercentWithContext; a plain (non-race) run can't detect it,
// since a torn read doesn't reliably crash or produce a value outside any
// fixed bound (rapid back-to-back calls to Percent(0) legitimately produce
// large, noisy percentages on their own, since the measurement window
// between consecutive calls shrinks — that's expected behavior of an
// instantaneous-rate measurement, not corruption).
func TestDebugConcurrentAccess(t *testing.T) {
	dbg := NewDebug("test", time.Now())

	var wg sync.WaitGroup
	for range 20 {
		wg.Go(func() {
			for range 20 {
				w := httptest.NewRecorder()
				r := httptest.NewRequest("GET", "/api/debug", nil)
				dbg.Get(w, r)

				var body struct {
					Data struct {
						Process struct {
							CPUPercent float64 `json:"cpu_percent"`
						} `json:"process"`
					} `json:"data"`
				}
				if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
					t.Errorf("invalid JSON response: %v", err)
					return
				}
				if body.Data.Process.CPUPercent < 0 {
					t.Errorf("negative cpu_percent: %v", body.Data.Process.CPUPercent)
				}
			}
		})
	}
	wg.Wait()
}
