package codebuddy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/enowdev/enowx/core/provider"
)

// Usage reports an account's credit balance. Only CodeBuddy CN exposes a credit
// meter (Tencent billing); the global .ai variant returns no quota data.
func (p *Provider) Usage(acc provider.Account) (*provider.Usage, error) {
	if p.v.name != variantCN.name {
		return &provider.Usage{}, nil // global has no credit meter
	}
	return p.fetchCNCredits(acc)
}

// cnMainSubProduct is the id of the main (monthly-cycle) package; everything else
// is a bonus package.
const cnMainSubProduct = "sp_tcaca_codebuddy_ide"

func (p *Provider) fetchCNCredits(acc provider.Account) (*provider.Usage, error) {
	token := strings.TrimSpace(acc.Cred("api_key"))
	if token == "" {
		return nil, fmt.Errorf("codebuddy-cn: no token")
	}
	now := time.Now()
	body, _ := json.Marshal(map[string]any{
		"PageNumber":               1,
		"PageSize":                 100,
		"ProductCode":              "p_tcaca",
		"Status":                   []int{0, 3},
		"PackageEndTimeRangeBegin": now.Add(-24 * time.Hour).Format("2006-01-02T15:04:05Z"),
		"PackageEndTimeRangeEnd":   now.Add(365 * 24 * time.Hour).Format("2006-01-02T15:04:05Z"),
	})
	req, err := http.NewRequest(http.MethodPost, p.v.base+"/v2/billing/meter/get-user-resource", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Domain", p.v.domain)
	req.Header.Set("User-Agent", "CLI/2.106.3 CodeBuddy/2.106.3")

	resp, err := p.doer.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("codebuddy-cn credits (HTTP %d)", resp.StatusCode)
	}

	var out struct {
		Code int `json:"code"`
		Data struct {
			Response struct {
				Data struct {
					Accounts []struct {
						SubProductCode      string `json:"SubProductCode"`
						Status              int    `json:"Status"`
						CapacitySize        float64 `json:"CapacitySize"`
						CapacityUsed        float64 `json:"CapacityUsed"`
						CapacityRemain      float64 `json:"CapacityRemain"`
						CycleCapacityUsed   any     `json:"CycleCapacityUsed"`
						CycleCapacityRemain any     `json:"CycleCapacityRemain"`
					} `json:"Accounts"`
				} `json:"Data"`
			} `json:"Response"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	if out.Code != 0 {
		return nil, fmt.Errorf("codebuddy-cn credits (code=%d)", out.Code)
	}

	var limit, used, remain float64
	for _, a := range out.Data.Response.Data.Accounts {
		if a.Status != 0 { // only active packages contribute usable credit
			continue
		}
		cycUsed, cycRemain := toFloat(a.CycleCapacityUsed), toFloat(a.CycleCapacityRemain)
		if a.SubProductCode == cnMainSubProduct {
			limit += a.CapacitySize
			used += cycUsed
			remain += cycRemain
		} else {
			// Bonus: prefer cycle figures; fall back to package figures when null.
			bUsed, bRemain := cycUsed, cycRemain
			if bRemain == 0 && a.CapacityRemain > 0 {
				bUsed, bRemain = a.CapacityUsed, a.CapacityRemain
			}
			limit += a.CapacitySize
			used += bUsed
			remain += bRemain
		}
	}
	return &provider.Usage{Limit: limit, Used: used, Remaining: remain}, nil
}

// toFloat coerces a JSON number (or null) that may arrive as float64/nil.
func toFloat(v any) float64 {
	if f, ok := v.(float64); ok {
		return f
	}
	return 0
}
