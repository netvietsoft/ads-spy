// Map mã vùng Google Ads Transparency (geo target criteria ID) -> tên nước.
// Chỉ các nước phổ biến; mã lạ sẽ hiển thị dạng số.
const GEO: Record<number, string> = {
  2840: 'Hoa Kỳ', 2704: 'Việt Nam', 2826: 'Anh', 2392: 'Nhật', 2410: 'Hàn Quốc',
  2764: 'Thái Lan', 2360: 'Indonesia', 2608: 'Philippines', 2458: 'Malaysia', 2702: 'Singapore',
  2356: 'Ấn Độ', 2036: 'Úc', 2156: 'Trung Quốc', 2158: 'Đài Loan', 2344: 'Hồng Kông',
  2446: 'Macau', 2116: 'Campuchia', 2418: 'Lào', 2104: 'Myanmar', 2050: 'Bangladesh',
  2586: 'Pakistan', 2144: 'Sri Lanka', 2524: 'Nepal', 2064: 'Bhutan', 2462: 'Maldives',
  2250: 'Pháp', 2276: 'Đức', 2724: 'Tây Ban Nha', 2380: 'Ý', 2528: 'Hà Lan',
  2056: 'Bỉ', 2756: 'Thụy Sĩ', 2040: 'Áo', 2620: 'Bồ Đào Nha', 2372: 'Ireland',
  2752: 'Thụy Điển', 2578: 'Na Uy', 2208: 'Đan Mạch', 2246: 'Phần Lan', 2616: 'Ba Lan',
  2203: 'Séc', 2348: 'Hungary', 2642: 'Romania', 2300: 'Hy Lạp', 2792: 'Thổ Nhĩ Kỳ',
  2643: 'Nga', 2804: 'Ukraine', 2124: 'Canada', 2076: 'Brazil', 2484: 'Mexico',
  2032: 'Argentina', 2152: 'Chile', 2170: 'Colombia', 2604: 'Peru', 2818: 'Ai Cập',
  2682: 'Ả Rập Xê Út', 2784: 'UAE', 2634: 'Qatar', 2414: 'Kuwait', 2048: 'Bahrain',
  2512: 'Oman', 2400: 'Jordan', 2422: 'Lebanon', 2368: 'Iraq', 2364: 'Iran',
  2376: 'Israel', 2504: 'Morocco', 2012: 'Algeria', 2788: 'Tunisia', 2710: 'Nam Phi',
  2566: 'Nigeria', 2404: 'Kenya', 2288: 'Ghana', 2231: 'Ethiopia', 2554: 'New Zealand',
};

export function regionName(id: number): string {
  return GEO[id] || `#${id}`;
}

// Danh sách quốc gia kèm mã geo (cho dropdown lọc vùng Google). Ưu tiên nước phổ biến lên đầu.
const PIN = [2704, 2840, 2826, 2392, 2410, 2764, 2360, 2608, 2458, 2702, 2356, 2036, 2158, 2344];
export const GEO_COUNTRIES: { geo: number; name: string }[] = [
  ...PIN.map((g) => ({ geo: g, name: GEO[g] })).filter((x) => x.name),
  ...Object.entries(GEO)
    .map(([g, name]) => ({ geo: Number(g), name }))
    .filter((x) => !PIN.includes(x.geo))
    .sort((a, b) => a.name.localeCompare(b.name)),
];
