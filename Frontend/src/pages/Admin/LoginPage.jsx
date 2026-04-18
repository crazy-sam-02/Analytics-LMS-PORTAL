import { useState } from "react";
import { Eye, EyeOff, Lock, UserRound } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import { Navigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { loginAdmin } from "@/features/Admin/adminAuthSlice";
import heroImage from "@/assets/hero.png";

export default function AdminLoginPage() {
  const dispatch = useDispatch();
  const { admin, loading, error } = useSelector((state) => state.adminAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberAdmin, setRememberAdmin] = useState(true);

  if (admin) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  const onSubmit = async (event) => {
    event.preventDefault();
    await dispatch(loginAdmin({ email, password }));
  };

  return (
    <section className="relative grid min-h-screen place-items-center bg-[#e9edf5] p-4 lg:p-8">
      <Card className="grid w-full max-w-6xl overflow-hidden rounded-[18px] border-white/60 bg-[#f7f8fc] shadow-[0_30px_70px_-30px_rgba(15,35,71,0.45)] lg:grid-cols-[1.35fr_1fr]">
        <div className="relative hidden min-h-167.5 overflow-hidden bg-linear-to-br from-[#005fae] to-[#0a4f9c] p-10 text-white lg:block">
          <img src={heroImage} alt="Admin Portal" className="absolute inset-0 h-full w-full object-cover opacity-25" />
          <div className="absolute inset-0 bg-linear-to-b from-[#0d3f7c]/20 via-[#0a63bb]/15 to-[#0d4e93]/45" />

          <div className="relative z-10 flex h-full flex-col justify-between">
            <div>
              <p className="text-[34px] leading-none font-semibold tracking-tight">TestAnalytics</p>
              <div className="mt-3 h-1 w-14 rounded-full bg-white/55" />
            </div>

            <div>
              <h1 className="max-w-md text-[56px] leading-[1.02] font-semibold tracking-tight">
                Lead your
                <br />
                campus with clarity.
              </h1>
              <p className="mt-6 max-w-sm text-base leading-relaxed text-blue-50/92">
                Monitor students, assessments, and insights with centralized controls designed for your college administrators.
              </p>
            </div>

            <div className="w-max rounded-xl border border-white/25 bg-white/12 px-4 py-3 text-sm text-blue-50 backdrop-blur-md">
              2,000+ admins managing exams this quarter
            </div>
          </div>
        </div>

        <div className="bg-[#f8f9fd] p-7 sm:p-10 lg:p-12">
          <Badge className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold tracking-wide text-blue-800 uppercase" variant="secondary">
            Admin Portal
          </Badge>
          <h2 className="mt-4 text-[38px] leading-tight font-semibold tracking-tight text-slate-900">Welcome Back</h2>
          <p className="mt-2 text-sm text-slate-500">Please enter your credentials to access your admin portal.</p>

          <form onSubmit={onSubmit} className="mt-9 space-y-6">
            <div>
              <label className="mb-2 block text-xs font-semibold text-slate-500 uppercase">Admin Email</label>
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                <UserRound className="size-4 text-slate-400" />
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  required
                  className="h-auto border-0 bg-transparent p-0 text-sm text-slate-700 shadow-none ring-0 focus-visible:ring-0"
                  placeholder="admin@college.edu"
                />
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-500 uppercase">
                <span>Password</span>
                <button type="button" className="text-[11px] font-semibold text-blue-700 normal-case">
                  Forgot Password?
                </button>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                <Lock className="size-4 text-slate-400" />
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-auto border-0 bg-transparent p-0 text-sm text-slate-700 shadow-none ring-0 focus-visible:ring-0"
                  placeholder="Enter password"
                />
                <button type="button" className="text-slate-400" onClick={() => setShowPassword((prev) => !prev)}>
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-500">
              <Checkbox
                checked={rememberAdmin}
                onCheckedChange={(checked) => setRememberAdmin(Boolean(checked))}
              />
              Keep me logged in for 30 days
            </label>

            {error ? <p className="text-sm text-red-500">{error}</p> : null}

            <Button
              type="submit"
              className="h-11 w-full rounded-xl bg-[#0767c2] text-base font-semibold text-white shadow-lg shadow-blue-700/25 hover:bg-[#0659a8]"
              disabled={loading}
            >
              {loading ? "Signing in..." : "Login as Admin"}
            </Button>
          </form>

          <p className="mt-8 text-xs text-slate-500">Need assistance? Contact technical support</p>
        </div>
      </Card>
    </section>
  );
}
